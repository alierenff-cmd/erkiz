# JavascriptInterface ile isaretli metotlar reflection ile cagrilir, korunmali.
-keepclassmembers class com.erkiz.iscitakip.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
