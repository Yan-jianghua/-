package games.qiuqiu.planet;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

public class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private WebView browser;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        browser = new WebView(this);
        browser.setBackgroundColor(0xff182a42);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        boolean debug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!ASSET_HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path != null && !path.contains("..") && ("/index.html".equals(path) || path.startsWith("/assets/"))) {
                    String mime = path.endsWith(".js") ? "text/javascript" :
                        path.endsWith(".css") ? "text/css" : "text/html";
                    try {
                        return new WebResourceResponse(mime, "utf-8", getAssets().open(path.substring(1)));
                    } catch (IOException ignored) { /* Report a missing bundled asset below. */ }
                }
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        setContentView(browser);
        // Android 15 edge-to-edge: keep room actions above system bars and the IME.
        browser.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        browser.loadUrl((debug ? "http://" : "https://") + ASSET_HOST + "/index.html");
    }

    @Override protected void onDestroy() {
        browser.destroy();
        super.onDestroy();
    }
}
