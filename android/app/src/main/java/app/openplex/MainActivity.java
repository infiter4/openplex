package app.openplex;

import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        // Android's WebView disables pinch-to-zoom by default. Turn it on (the page's viewport already
        // permits scaling) and hide the legacy on-screen +/- zoom buttons.
        WebSettings settings = this.getBridge().getWebView().getSettings();
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
    }
}
