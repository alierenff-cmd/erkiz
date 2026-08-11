package com.erkiz.iscitakip

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Tek Activity. Yerel web arayuzunu WebViewAssetLoader uzerinden
 * https://appassets.androidplatform.net/ origin'inde sunar.
 *
 * Neden file:// degil: file:// origin'inde secure-context gerektiren
 * API'ler (getUserMedia / geolocation) calismaz ve allowUniversalAccess
 * gibi tehlikeli ayarlari acmak gerekir. AssetLoader bu ihtiyaci
 * tamamen ortadan kaldirir.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private var pendingPermissionRequest: PermissionRequest? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var pendingGeolocationOrigin: String? = null

    private val cameraLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val request = pendingPermissionRequest
        pendingPermissionRequest = null
        if (request == null) return@registerForActivityResult
        if (granted) {
            request.grant(request.resources)
        } else {
            request.deny()
        }
    }

    private val locationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val callback = pendingGeolocationCallback
        val origin = pendingGeolocationOrigin
        pendingGeolocationCallback = null
        pendingGeolocationOrigin = null

        val granted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                result[Manifest.permission.ACCESS_COARSE_LOCATION] == true

        // WebChromeClient'dan gelen bekleyen bir istek varsa yanıtla
        callback?.invoke(origin, granted, false)

        // NativeBridge üzerinden gelen isteği JS tarafına bildir
        val jsFunc = if (granted) "onLocationPermissionGranted" else "onLocationPermissionDenied"
        webView.evaluateJavascript("window.NativeEvents && window.NativeEvents.$jsFunc()", null)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true          // Arayuz tamamen JS tabanli.
            domStorageEnabled = true          // Riza kaydi ve cihaz kimligi icin.

            // --- Kapatilan tehlikeli ayarlar ---
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false

            mediaPlaybackRequiresUserGesture = false
            setGeolocationEnabled(true)
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // NativeBridge baglantisi
        webView.addJavascriptInterface(NativeBridge(this), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            /**
             * Uygulama kendi origin'i disina asla gezinmez. Harici bir
             * link tiklanirsa yok sayilir; boylece WebView yabanci bir
             * siteye tasinip kamera/konum izinlerini devralamaz.
             */
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean = !isAppOrigin(request.url)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (!isAppOrigin(request.origin)) {
                        request.deny()
                        return@runOnUiThread
                    }

                    // Kamera izni varsa tum kaynaklari (Video + Audio vb.) onayla.
                    // Bazi kutuphaneler sessizce ses de isteyebiliyor, reddetmek cokertiyor.
                    if (hasPermission(Manifest.permission.CAMERA)) {
                        request.grant(request.resources)
                    } else {
                        pendingPermissionRequest = request
                        cameraLauncher.launch(Manifest.permission.CAMERA)
                    }
                }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                runOnUiThread {
                    if (!isAppOrigin(Uri.parse(origin))) {
                        callback.invoke(origin, false, false)
                        return@runOnUiThread
                    }
                    val fine = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                    val coarse = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                    if (fine || coarse) {
                        callback.invoke(origin, true, false)
                    } else {
                        pendingGeolocationOrigin = origin
                        pendingGeolocationCallback = callback
                        locationLauncher.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                            )
                        )
                    }
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl(APP_BASE_URL + "index.html")
    }

    fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    fun hasLocationPermission(): Boolean =
        hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
                hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)

    fun requestLocationPermission() {
        runOnUiThread {
            locationLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                )
            )
        }
    }

    fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
        }
        startActivity(intent)
    }

    fun appVersion(): String {
        return try {
            val pInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0)
            }
            pInfo.versionName ?: "1.0.0"
        } catch (e: Exception) {
            "1.0.0"
        }
    }

    private fun isAppOrigin(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == APP_HOST

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val APP_BASE_URL = "https://$APP_HOST/assets/"
    }
}
