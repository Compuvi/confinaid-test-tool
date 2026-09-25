; app-hooks.nsh — NSIS installer hooks for Confinaid Test Tool
;
; Tauri calls these macros at well-defined points in the install/uninstall
; lifecycle.  We use them to gracefully close the running app before the
; installer tries to overwrite the locked exe.
;
; Macro execution order (install):
;   PreInstall → [Tauri copies files] → PostInstall
;
; Macro execution order (uninstall):
;   PreUnInstall → [Tauri removes files] → PostUnInstall

; ── Helpers ──────────────────────────────────────────────────────────────────

; Close all windows belonging to the given process name, then wait up to
; ~2 s for the process to exit before continuing.  Uses taskkill /IM so it
; works even when the process has no visible window (e.g. background tray).
!macro _CloseApp PROC_NAME
    DetailPrint "Closing ${PROC_NAME} if running…"
    ; /F forces termination if graceful close is ignored after 5 s.
    nsExec::ExecToLog 'taskkill /IM "${PROC_NAME}" /T'
    ; Give the OS a moment to release file locks before we copy new files.
    Sleep 1500
!macroend

; ── Install hooks ─────────────────────────────────────────────────────────────

!macro NSIS_HOOK_PREINSTALL
    !insertmacro _CloseApp "confinaid-test-tool.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
    ; Nothing needed post-install for the test tool.
!macroend

; ── Uninstall hooks ───────────────────────────────────────────────────────────

!macro NSIS_HOOK_PREUNINSTALL
    !insertmacro _CloseApp "confinaid-test-tool.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
    ; Nothing needed post-uninstall.
!macroend
