package com.erkiz.iscitakip

import android.webkit.JavascriptInterface

/**
 * Web katmanina acilan cok dar bir yuzey.
 *
 * Bilincli olarak SADECE izin durumu sorgulama ve izin isteme var.
 * Dosya sistemi, ag, kayit gibi hicbir sey buradan erisilemiyor - JavascriptInterface
 * gecmiste kotuye kullanildigi icin yuzey minimumda tutuldu.
 */
class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun hasLocationPermission(): Boolean = activity.hasLocationPermission()

    @JavascriptInterface
    fun requestLocationPermission() = activity.requestLocationPermission()

    @JavascriptInterface
    fun hasCameraPermission(): Boolean =
        activity.hasPermission(android.Manifest.permission.CAMERA)

    @JavascriptInterface
    fun openAppSettings() = activity.openAppSettings()

    @JavascriptInterface
    fun appVersion(): String = activity.appVersion()

    /** Web katmani, http:// sunucuya izin verilip verilmeyecegini buradan ogrenir. */
    @JavascriptInterface
    fun isDebugBuild(): Boolean = BuildConfig.DEBUG
}
