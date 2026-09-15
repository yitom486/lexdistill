#![cfg(windows)]

use std::fmt;
use std::mem::size_of;
use std::ptr::null;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JobObjectError {
    Create(u32),
    SetInformation(u32),
    AssignProcess(u32),
}

impl fmt::Display for JobObjectError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Create(code) => write!(formatter, "CreateJobObjectW failed (Win32 error {code})"),
            Self::SetInformation(code) => {
                write!(
                    formatter,
                    "SetInformationJobObject failed (Win32 error {code})"
                )
            }
            Self::AssignProcess(code) => {
                write!(
                    formatter,
                    "AssignProcessToJobObject failed (Win32 error {code})"
                )
            }
        }
    }
}

impl std::error::Error for JobObjectError {}

/// Owns the Job Object handle that governs one sidecar process tree.
pub(crate) struct JobObject {
    // A Windows HANDLE is an opaque pointer-sized value. Store only the Job
    // handle value here: the process HANDLE remains owned by Child and is
    // borrowed only for AssignProcessToJobObject while Child is alive.
    handle: usize,
}

impl JobObject {
    /// Creates a kill-on-close Job Object and assigns the Child-owned process
    /// handle to it before the caller exposes the sidecar to the app state.
    pub(crate) fn attach_to_process(process_handle: HANDLE) -> Result<Self, JobObjectError> {
        // The null name creates an unnamed Job Object. This call does not take
        // ownership of process_handle; Child retains and closes that handle.
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err(JobObjectError::Create(unsafe { GetLastError() }));
        }

        let job = Self {
            handle: handle as usize,
        };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let configured = unsafe {
            SetInformationJobObject(
                job.raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(JobObjectError::SetInformation(unsafe { GetLastError() }));
        }

        let assigned = unsafe { AssignProcessToJobObject(job.raw_handle(), process_handle) };
        if assigned == 0 {
            return Err(JobObjectError::AssignProcess(unsafe { GetLastError() }));
        }

        Ok(job)
    }

    fn raw_handle(&self) -> HANDLE {
        self.handle as HANDLE
    }
}

impl Drop for JobObject {
    fn drop(&mut self) {
        // JobObject is non-Clone and owns this one handle value. Rust calls
        // Drop exactly once, so this is the sole CloseHandle for the Job;
        // Child remains the sole owner of the unrelated process HANDLE.
        let _ = unsafe { CloseHandle(self.raw_handle()) };
    }
}

#[cfg(test)]
mod tests {
    use super::JobObjectError;

    #[test]
    fn errors_keep_the_win32_stage_and_code() {
        assert_eq!(
            JobObjectError::AssignProcess(5).to_string(),
            "AssignProcessToJobObject failed (Win32 error 5)"
        );
    }
}
