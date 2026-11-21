package com.ihab.grades;

import android.app.Activity;
import android.content.ContentValues;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private Uri camUri;
    private static final int REQ_CAM = 77, REQ_PICK = 78;
    private static final String HOST = "ihabali300-png.github.io", BASE = "/math-grades/";
    // false = الملفات من جوه الـ APK (سريع ومن غير نت) — true = من النت لما يكون فيه نسخة أحدث
    private volatile boolean useNet = false;

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384]; int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toByteArray();
    }
    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".css")) return "text/css";
        return "application/octet-stream";
    }
    private WebResourceResponse wrap(String rel, byte[] data) {
        WebResourceResponse r = new WebResourceResponse(mime(rel), "utf-8", new ByteArrayInputStream(data));
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Access-Control-Allow-Origin", "*");
        r.setResponseHeaders(h);
        return r;
    }
    private byte[] fromNet(String url, int timeout) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(timeout); c.setReadTimeout(timeout); c.setUseCaches(false);
            if (c.getResponseCode() != 200) return null;
            return readAll(c.getInputStream());
        } catch (Exception e) { return null; }
    }
    private byte[] fromAsset(String rel) {
        try { return readAll(getAssets().open("www/" + rel)); } catch (Exception e) { return null; }
    }
    private int verOf(byte[] json) {
        try { return new JSONObject(new String(json, "UTF-8")).getInt("v"); } catch (Exception e) { return 0; }
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B120D);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100); // تجاهل تكبير الخط بتاع الموبايل (التطبيق ليه حجم عرض خاص بيه في الإعدادات)
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " GradesApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!"GET".equals(r.getMethod()) || !HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || !path.startsWith(BASE)) return null;
                String rel = path.substring(BASE.length());
                if (rel.isEmpty()) rel = "index.html";
                boolean isVer = rel.equals("version.json");
                if (useNet || isVer) {
                    byte[] net = fromNet(u.toString(), isVer ? 4000 : 6000);
                    if (net != null) return wrap(rel, net);
                }
                byte[] a = fromAsset(rel);
                if (a != null) return wrap(rel, a);
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (u.toString().startsWith(BuildConfig.APP_URL)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    if (p.isCaptureEnabled()) {
                        File dir = new File(getCacheDir(), "pdf");
                        dir.mkdirs();
                        File f = new File(dir, "cam_" + System.currentTimeMillis() + ".jpg");
                        camUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        i.putExtra(MediaStore.EXTRA_OUTPUT, camUri);
                        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivityForResult(i, REQ_CAM);
                    } else {
                        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        i.setType("image/*");
                        startActivityForResult(Intent.createChooser(i, "اختار صورة"), REQ_PICK);
                    }
                } catch (Exception e) {
                    fileCb.onReceiveValue(null);
                    fileCb = null;
                    Toast.makeText(MainActivity.this, "مقدرتش أفتح الكاميرا", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void useLatest() { useNet = true; }

            @JavascriptInterface
            public void print(final String name) {
                runOnUiThread(() -> {
                    PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                    PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape()).build();
                    pm.print(name, web.createPrintDocumentAdapter(name), attrs);
                });
            }

            @JavascriptInterface
            public void savePdf(String b64, String name) {
                try {
                    byte[] data = Base64.decode(b64, Base64.DEFAULT);
                    String where;
                    if (Build.VERSION.SDK_INT >= 29) {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                        cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/سجل الدرجات");
                        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(data); }
                        where = "التنزيلات ← سجل الدرجات";
                    } else {
                        File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "");
                        dir.mkdirs();
                        File f = new File(dir, name);
                        try (FileOutputStream os = new FileOutputStream(f)) { os.write(data); }
                        where = f.getAbsolutePath();
                    }
                    final String msg = "✅ اتحفظ في " + where;
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
                } catch (Exception e) {
                    final String msg = "ما اتحفظش: " + e.getMessage();
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
                }
            }

            @JavascriptInterface
            public void sharePdf(String b64, String name) {
                try {
                    byte[] data = Base64.decode(b64, Base64.DEFAULT);
                    File dir = new File(getCacheDir(), "pdf");
                    dir.mkdirs();
                    File f = new File(dir, name);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(data); }
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("application/pdf");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    runOnUiThread(() -> {
                        Intent wa = new Intent(send).setPackage("com.whatsapp");
                        try { startActivity(wa); }
                        catch (Exception e) {
                            try { startActivity(new Intent(send).setPackage("com.whatsapp.w4b")); }
                            catch (Exception e2) { startActivity(Intent.createChooser(send, "مشاركة الـ PDF")); }
                        }
                    });
                } catch (Exception e) {
                    final String msg = "مقدرتش أشارك: " + e.getMessage();
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
                }
            }
        }, "AndroidPrint");
        setContentView(web);
        if (b == null) web.clearCache(true);
        if (b != null) { web.restoreState(b); return; }
        web.loadDataWithBaseURL(null, "<html><body style='margin:0;background:#0b120d;color:#a3e635;display:flex;height:100vh;align-items:center;justify-content:center;font:bold 24px sans-serif'>📘 سجل الدرجات</body></html>", "text/html", "utf-8", null);
        new Thread(() -> {
            // لو فيه نسخة أحدث على النت نستخدمها، غير كده نفتح من الملفات اللي جوه الـ APK
            int local = verOf(fromAsset("version.json"));
            byte[] remote = fromNet(BuildConfig.APP_URL + "version.json?" + System.currentTimeMillis(), 2500);
            useNet = local == 0 || (remote != null && verOf(remote) > local);
            runOnUiThread(() -> web.loadUrl(BuildConfig.APP_URL));
        }).start();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (req == REQ_CAM && camUri != null) out = new Uri[]{camUri};
            else if (req == REQ_PICK && data != null && data.getData() != null) out = new Uri[]{data.getData()};
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
    }

    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack && window.appBack()) ? '1' : '0'", v -> {
            if (v == null || !v.contains("1")) finish();
        });
    }
}
