// tsx derives its cache directory from process.geteuid() where available,
// then falls back to os.userInfo(). On Windows process.geteuid() is absent,
// and some Node installations fail that fallback with ERR_SYSTEM_ERROR /
// uv_os_get_passwd ENOMEM before tsx can load the application. A stable
// synthetic id is sufficient here: it is used only to name tsx's temp dir.
const processWithEuid = process as typeof process & { geteuid?: () => number };

if (process.platform === 'win32' && typeof processWithEuid.geteuid !== 'function') {
  processWithEuid.geteuid = () => 0;
}

export {};
