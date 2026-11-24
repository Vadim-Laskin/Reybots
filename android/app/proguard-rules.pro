# Мост между страницей и приложением (запасной вариант на старых WebView)
-keepclassmembers class ru.reu256.cabinet.MainActivity$LegacyBridge {
    @android.webkit.JavascriptInterface <methods>;
}
