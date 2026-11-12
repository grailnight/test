package app.minigram;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Обёртка над мобильным сайтом Instagram, в каждую страницу которого вставляется фильтр. */
public class MainActivity extends Activity {
    private static final String HOME = "https://www.instagram.com/";
    private static final int PICK_FILE = 1;

    private WebView web;
    private String filter = "";
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        filter = readAsset("minigram.user.js");

        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // Без пометки WebView сайт отдаёт обычную мобильную версию, как в Chrome.
        settings.setUserAgentString(settings.getUserAgentString()
                .replace("; wv", "")
                .replaceAll("Version/\\d+\\.\\d+ ", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (!"http".equals(scheme) && !"https".equals(scheme)) {
                    return true; // instagram://, intent:// и т. п. — «открыть в приложении» не нужно
                }
                if (isInstagram(uri)) {
                    String path = uri.getPath();
                    if ("/reels".equals(path) || "/reels/".equals(path)) {
                        view.loadUrl(HOME);
                        return true;
                    }
                    return false;
                }
                if (isLogin(uri)) {
                    return false; // вход через Facebook
                }
                openExternally(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                inject(view, url);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                inject(view, url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                inject(view, url);
                CookieManager.getInstance().flush();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                } catch (RuntimeException e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(HOME);
        }
    }

    /** Скрипт сам защищён от повторного запуска, поэтому вставляем его на каждом этапе загрузки. */
    private void inject(WebView view, String url) {
        if (url != null && isInstagram(Uri.parse(url))) {
            view.evaluateJavascript(filter, null);
        }
    }

    private static boolean isInstagram(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equals("instagram.com") || host.endsWith(".instagram.com"));
    }

    private static boolean isLogin(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equals("facebook.com") || host.endsWith(".facebook.com"));
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (RuntimeException ignored) {
            // нет приложения, которое умеет открыть ссылку
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Не найден файл фильтра " + name, e);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }
}
