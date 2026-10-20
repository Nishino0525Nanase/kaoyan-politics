package com.nishino.zhizheng;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/** Offline, platform-only host for the packaged 知政 learning interface. */
public final class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String HOME_URL = "https://" + ASSET_HOST + "/index.html";
    private static final int MAX_BACKUP_BYTES = 12 * 1024 * 1024;
    private static final int REQUEST_EXPORT = 7101;
    private static final int REQUEST_IMPORT = 7102;
    private static final int CREAM = Color.rgb(246, 244, 238);
    private static final int INK = Color.rgb(36, 44, 43);
    private static final int CINNABAR = Color.rgb(172, 71, 55);
    private static final Pattern IMAGE_PATH = Pattern.compile("/(?:assets|images)/[A-Za-z0-9_./-]+\\.(?:png|jpg|jpeg|webp|gif|svg)", Pattern.CASE_INSENSITIVE);
    private static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
            + "object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; "
            + "media-src 'none'; base-uri 'self'; form-action 'none'";

    private FrameLayout container;
    private WebView webView;
    private View errorView;
    private TextView errorDetail;
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private boolean destroyed;
    private int pendingOperation;
    private File pendingExportFile;
    private String pendingImportJson;
    private long lastBackTime;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();
        container = new FrameLayout(this);
        container.setBackgroundColor(CREAM);
        setContentView(container);
        installInsets();
        if (savedInstanceState != null) {
            pendingOperation = savedInstanceState.getInt("pending_operation", 0);
            String path = savedInstanceState.getString("pending_export_path");
            if (path != null) {
                File candidate = new File(path);
                try {
                    if (candidate.getCanonicalFile().getParentFile().equals(getCacheDir().getCanonicalFile())
                            && candidate.getName().startsWith("zhizheng-backup-")) {
                        pendingExportFile = candidate;
                    }
                } catch (IOException ignored) { }
            }
            // If process death interrupted preparation before the picker, allow a fresh export.
            if (pendingOperation == REQUEST_EXPORT && pendingExportFile == null) pendingOperation = 0;
        }
        createWebView(savedInstanceState == null ? null : savedInstanceState.getBundle("web_state"));
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    @SuppressWarnings("deprecation")
    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(CREAM);
        window.setNavigationBarColor(CREAM);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
    }

    @SuppressWarnings("deprecation")
    private void installInsets() {
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                left = bars.left;
                top = bars.top;
                right = bars.right;
                bottom = Math.max(bars.bottom, keyboard.bottom);
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(left, top, right, bottom);
            return insets;
        });
        container.requestApplyInsets();
    }

    @SuppressWarnings("deprecation")
    private void createWebView(Bundle savedWebState) {
        try {
            WebView.setWebContentsDebuggingEnabled(false);
            webView = new WebView(this);
            webView.setBackgroundColor(CREAM);
            webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(false);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
            settings.setBlockNetworkLoads(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setGeolocationEnabled(false);
            settings.setMediaPlaybackRequiresUserGesture(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(true);
            settings.setSupportZoom(true);
            settings.setBuiltInZoomControls(true);
            settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setTextZoom(100);
            settings.setDefaultTextEncodingName("UTF-8");
            if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
            webView.addJavascriptInterface(new BackupBridge(), "AndroidBridge");
            webView.setWebViewClient(new LocalAssetClient());
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(PermissionRequest request) { request.deny(); }

                @Override
                public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                    callback.invoke(origin, false, false);
                }

                @Override
                public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    // The only import surface is the explicit, bounded JSON backup bridge.
                    callback.onReceiveValue(null);
                    return true;
                }

                @Override
                public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                    if (!isUserGesture || destroyed) return false;
                    // A target=_blank destination is routed without ever loading it in a bridged WebView.
                    WebView popup = new WebView(MainActivity.this);
                    popup.getSettings().setJavaScriptEnabled(false);
                    popup.getSettings().setAllowFileAccess(false);
                    popup.getSettings().setAllowContentAccess(false);
                    popup.getSettings().setBlockNetworkLoads(true);
                    popup.setWebViewClient(new WebViewClient() {
                        private boolean routed;
                        private boolean route(String url) {
                            if (routed) return true;
                            routed = true;
                            routeNavigation(Uri.parse(url));
                            popup.post(popup::destroy);
                            return true;
                        }
                        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return route(request.getUrl().toString()); }
                        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return route(url); }
                        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                            return blocked(403, "Forbidden");
                        }
                    });
                    ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
                    resultMsg.sendToTarget();
                    return true;
                }
            });
            webView.setDownloadListener((url, userAgent, contentDisposition, mime, length) -> routeNavigation(Uri.parse(url)));
            container.addView(webView, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            boolean restored = savedWebState != null && webView.restoreState(savedWebState) != null;
            if (!restored || !isAllowedAsset(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) {
                webView.loadUrl(HOME_URL);
            }
        } catch (RuntimeException failure) {
            if (webView != null) {
                container.removeView(webView);
                webView.destroy();
                webView = null;
            }
            showError("系统网页组件暂时无法启动。请确认 Android System WebView 已启用，再点击重试。");
        }
    }

    private static boolean isLocalOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && ASSET_HOST.equals(uri.getEncodedAuthority());
    }

    private static String assetPath(Uri uri) {
        if (!isLocalOrigin(uri)) return null;
        String encoded = uri.getEncodedPath();
        if (encoded == null || encoded.isEmpty() || "/".equals(encoded)) return "/index.html";
        // Permit only unescaped packaged paths. Reject encoded traversal, separators, empty or dot segments.
        if (!encoded.matches("/[A-Za-z0-9_./-]+") || encoded.contains("//") || encoded.indexOf('\\') >= 0) return null;
        for (String segment : encoded.substring(1).split("/")) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) return null;
        }
        if ("/index.html".equals(encoded) || "/style.css".equals(encoded)
                || "/app.js".equals(encoded) || "/compat.js".equals(encoded) || "/questions.json".equals(encoded)
                || IMAGE_PATH.matcher(encoded).matches()) return encoded;
        return null;
    }

    private static boolean isAllowedAsset(Uri uri) { return assetPath(uri) != null; }

    private boolean isTrustedPage() {
        if (destroyed || webView == null || webView.getUrl() == null) return false;
        String path = assetPath(Uri.parse(webView.getUrl()));
        return "/index.html".equals(path);
    }

    private boolean routeNavigation(Uri uri) {
        if (destroyed || uri == null) return true;
        if (isAllowedAsset(uri)) {
            if (webView != null) {
                hideError();
                webView.loadUrl(uri.toString());
            }
            return true;
        }
        if (!isLocalOrigin(uri) && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            try { startActivity(intent); }
            catch (ActivityNotFoundException | SecurityException missing) { showToast("未找到可打开链接的浏览器"); }
        } else {
            showToast("此链接无法在应用中打开");
        }
        return true;
    }

    private final class LocalAssetClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return true;
            if (!"GET".equalsIgnoreCase(request.getMethod())) return true;
            if (isAllowedAsset(request.getUrl())) return false;
            return routeNavigation(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            return isAllowedAsset(uri) ? false : routeNavigation(uri);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (!"GET".equalsIgnoreCase(request.getMethod())) return blocked(405, "Method Not Allowed");
            String path = assetPath(request.getUrl());
            if (path == null) return blocked(403, "Forbidden");
            try {
                InputStream stream = getAssets().open("web" + path, AssetManager.ACCESS_STREAMING);
                return new WebResourceResponse(mimeType(path), isText(path) ? "UTF-8" : null,
                        200, "OK", responseHeaders(), stream);
            } catch (IOException missing) {
                return blocked(404, "Not Found");
            }
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (!isAllowedAsset(Uri.parse(url))) {
                view.stopLoading();
                showError("已阻止非应用页面。点击重试返回离线题库。");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!isAllowedAsset(Uri.parse(url))) return;
            if (isTrustedPage()) {
                view.evaluateJavascript("document.documentElement.classList.add('native-app');", null);
                deliverPendingImport();
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isLocalOrigin(request.getUrl())) showError("离线页面暂时没有打开，请点击重试。");
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && isLocalOrigin(request.getUrl()) && response.getStatusCode() >= 400) {
                showError("离线资料未能载入，请点击重试。");
            }
        }
    }

    private static Map<String, String> responseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", CSP);
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Referrer-Policy", "no-referrer");
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    private static WebResourceResponse blocked(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
                responseHeaders(), new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    private static boolean isText(String path) {
        return path.endsWith(".html") || path.endsWith(".css") || path.endsWith(".js") || path.endsWith(".json") || path.endsWith(".svg");
    }

    private static String mimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /** Only these two methods are exposed to the fixed, packaged top-level document. */
    public final class BackupBridge {
        @JavascriptInterface
        public void exportBackup(String json) {
            runOnUiThread(() -> {
                if (!isTrustedPage()) return;
                if (pendingOperation != 0) { showToast("请先完成当前的文件操作"); return; }
                if (json == null || json.length() > MAX_BACKUP_BYTES) { showToast("备份过大，最多支持 12 MiB"); return; }
                pendingOperation = REQUEST_EXPORT;
                ioExecutor.execute(() -> prepareExport(json));
            });
        }

        @JavascriptInterface
        public void importBackup() {
            runOnUiThread(() -> {
                if (!isTrustedPage()) return;
                if (pendingOperation != 0) { showToast("请先完成当前的文件操作"); return; }
                pendingOperation = REQUEST_IMPORT;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, REQUEST_IMPORT); }
                catch (ActivityNotFoundException | SecurityException missing) {
                    pendingOperation = 0;
                    showToast("系统文件选择器暂不可用");
                }
            });
        }
    }

    private void prepareExport(String json) {
        File exportFile = null;
        try {
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_BACKUP_BYTES) throw new IOException("size");
            new JSONObject(json); // Export only well-formed JSON objects.
            exportFile = File.createTempFile("zhizheng-backup-", ".json", getCacheDir());
            try (OutputStream output = new FileOutputStream(exportFile)) { output.write(bytes); }
            final File readyFile = exportFile;
            runOnUiThread(() -> {
                if (destroyed) { readyFile.delete(); return; }
                if (!isTrustedPage()) {
                    readyFile.delete();
                    pendingOperation = 0;
                    return;
                }
                pendingExportFile = readyFile;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, "知政学习记录_" + new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(new java.util.Date()) + ".json");
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try { startActivityForResult(intent, REQUEST_EXPORT); }
                catch (ActivityNotFoundException | SecurityException missing) {
                    clearPendingExport();
                    pendingOperation = 0;
                    showToast("系统文件保存界面暂不可用");
                }
            });
        } catch (Exception invalid) {
            if (exportFile != null) exportFile.delete();
            runOnUiThread(() -> {
                if (destroyed) return;
                pendingOperation = 0;
                showToast("无法准备备份：请确认记录有效且不超过 12 MiB");
            });
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_EXPORT && requestCode != REQUEST_IMPORT) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (requestCode == REQUEST_EXPORT) clearPendingExport();
            pendingOperation = 0;
            return;
        }
        final Uri uri = data.getData();
        if (!"content".equals(uri.getScheme())) {
            if (requestCode == REQUEST_EXPORT) clearPendingExport();
            pendingOperation = 0;
            showToast("未获取到有效文件，请重试");
            return;
        }
        // The picker has finished; a process restart during background I/O must not leave a stale busy flag.
        pendingOperation = 0;
        if (requestCode == REQUEST_EXPORT) {
            final File source = pendingExportFile;
            pendingExportFile = null;
            if (source == null || !source.isFile()) {
                pendingOperation = 0;
                showToast("待导出的记录已失效，请重新导出");
                return;
            }
            ioExecutor.execute(() -> {
                boolean success = false;
                try (InputStream input = new FileInputStream(source); OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("No output stream");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                    success = true;
                } catch (IOException | SecurityException ignored) { }
                finally { source.delete(); }
                final boolean saved = success;
                runOnUiThread(() -> { if (destroyed) return; pendingOperation = 0; showToast(saved ? "学习记录已保存" : "保存失败，请检查位置或剩余空间后重试"); });
            });
        } else {
            ioExecutor.execute(() -> readImport(uri));
        }
    }

    private void readImport(Uri uri) {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("No input stream");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count; int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > MAX_BACKUP_BYTES) throw new BackupTooLargeException();
                output.write(buffer, 0, count);
            }
            String json = new String(output.toByteArray(), StandardCharsets.UTF_8);
            if (json.startsWith("\uFEFF")) json = json.substring(1);
            new JSONObject(json);
            final String importedJson = json;
            runOnUiThread(() -> {
                if (destroyed) return;
                pendingOperation = 0;
                pendingImportJson = importedJson;
                if (isTrustedPage()) deliverPendingImport();
                else if (webView != null) webView.loadUrl(HOME_URL);
            });
        } catch (BackupTooLargeException tooLarge) {
            importFailed("文件超过 12 MiB，无法导入");
        } catch (Exception invalid) {
            importFailed("无法读取此记录，请选择知政导出的 JSON 备份");
        }
    }

    private static final class BackupTooLargeException extends IOException { }

    private void importFailed(String message) {
        runOnUiThread(() -> { if (destroyed) return; pendingOperation = 0; showToast(message); });
    }

    private void deliverPendingImport() {
        if (pendingImportJson == null || !isTrustedPage()) return;
        final String payload = pendingImportJson;
        pendingImportJson = null;
        String script = "(function(){var app=window.ZhizhengApp;if(app&&typeof app.onImportBackup==='function'){app.onImportBackup("
                + JSONObject.quote(payload) + ");return true;}return false;})()";
        webView.evaluateJavascript(script, result -> {
            if (destroyed) return;
            if (!"true".equals(result)) showToast("页面尚未就绪，请稍后重新导入记录");
        });
    }

    private void clearPendingExport() {
        File file = pendingExportFile;
        pendingExportFile = null;
        if (file != null) file.delete();
    }

    private void showError(String detail) {
        if (destroyed || container == null) return;
        if (errorView == null) {
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setGravity(Gravity.CENTER);
            box.setBackgroundColor(CREAM);
            int pad = dp(30); box.setPadding(pad, pad, pad, pad);
            TextView title = new TextView(this);
            title.setText("题库暂时没有打开"); title.setTextColor(INK); title.setTextSize(21); title.setGravity(Gravity.CENTER);
            box.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            errorDetail = new TextView(this);
            errorDetail.setTextColor(Color.rgb(119, 126, 109)); errorDetail.setTextSize(15); errorDetail.setGravity(Gravity.CENTER); errorDetail.setLineSpacing(dp(5), 1f);
            LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            detailParams.topMargin = dp(15); detailParams.bottomMargin = dp(24); box.addView(errorDetail, detailParams);
            Button retry = new Button(this); retry.setText("重新载入"); retry.setTextColor(CINNABAR); retry.setMinHeight(dp(48));
            retry.setOnClickListener(view -> {
                hideError();
                if (webView == null) createWebView(null);
                else webView.loadUrl(HOME_URL);
            });
            box.addView(retry, new LinearLayout.LayoutParams(dp(160), dp(52)));
            TextView footnote = new TextView(this); footnote.setText("重试不会清除你的学习记录"); footnote.setTextSize(12); footnote.setTextColor(Color.rgb(145, 151, 131)); footnote.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams footParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT); footParams.topMargin = dp(16); box.addView(footnote, footParams);
            errorView = box;
            container.addView(errorView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        errorDetail.setText(detail);
        errorView.setVisibility(View.VISIBLE);
        errorView.bringToFront();
    }

    private void hideError() { if (errorView != null) errorView.setVisibility(View.GONE); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void showToast(String text) { if (!destroyed) Toast.makeText(this, text, Toast.LENGTH_SHORT).show(); }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (destroyed) return;
        if (webView != null && isTrustedPage() && (errorView == null || errorView.getVisibility() != View.VISIBLE)) {
            webView.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(!d)return false;if(typeof d.close==='function')d.close();else d.removeAttribute('open');return true;})()", result -> {
                if (!destroyed && !"true".equals(result)) navigateBackOrExit();
            });
        } else navigateBackOrExit();
    }

    private void navigateBackOrExit() {
        if (webView != null && webView.canGoBack()) {
            hideError();
            webView.goBack();
            lastBackTime = 0;
            return;
        }
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - lastBackTime < 2000) finish();
        else { lastBackTime = now; showToast("再按一次返回键退出"); }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            if (isTrustedPage()) webView.evaluateJavascript("(function(){var app=window.ZhizhengApp;if(app&&typeof app.flushState==='function')app.flushState();})()", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) { Bundle webState = new Bundle(); webView.saveState(webState); outState.putBundle("web_state", webState); }
        outState.putInt("pending_operation", pendingOperation);
        if (pendingExportFile != null) outState.putString("pending_export_path", pendingExportFile.getAbsolutePath());
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            container.removeView(webView);
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        ioExecutor.shutdown();
        super.onDestroy();
    }
}
