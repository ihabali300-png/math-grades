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
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B120D);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " GradesApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (u.toString().startsWith(BuildConfig.APP_URL)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
        });
        web.addJavascriptInterface(new Object() {
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
        if (b != null) web.restoreState(b); else web.loadUrl(BuildConfig.APP_URL);
    }

    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    @Override
    public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
