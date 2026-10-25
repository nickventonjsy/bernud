package uk.bernud.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

// Bernard's dashboard in a WebView that keeps running (with the microphone) when you switch apps.
class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_TALK = "talk"
        private const val HOME = "https://bernud.onrender.com/?app=android"
        private val OWN_HOSTS = setOf("bernud.onrender.com", "bernud-server.onrender.com")
    }

    private lateinit var web: WebView
    private var pendingTalk = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (has(Manifest.permission.RECORD_AUDIO)) startBackgroundService()
        askBatteryOnce()
    }

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = 0xFF0B0B0F.toInt()
        window.navigationBarColor = 0xFF0B0B0F.toInt()

        web = WebView(this)
        setContentView(web)
        web.setBackgroundColor(0xFF0B0B0F.toInt())
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString BernudApp/1"
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val host = req.url.host ?: return false
                if (host in OWN_HOSTS) return false
                // Gmail drafts, YouTube, websites etc. open in their own apps.
                try { startActivity(Intent(Intent.ACTION_VIEW, req.url)) } catch (_: Exception) {}
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (pendingTalk) { pendingTalk = false; view.postDelayed({ talk() }, 1500) }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.origin.host !in OWN_HOSTS) { request.deny(); return }
                val ok = request.resources.filter {
                    (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && has(Manifest.permission.RECORD_AUDIO)) ||
                        (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && has(Manifest.permission.CAMERA))
                }
                runOnUiThread { if (ok.isEmpty()) request.deny() else request.grant(ok.toTypedArray()) }
            }
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try { pickFile.launch(params.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
            }
        }

        Bus.talk = { talk() }
        Bus.finish = { finishAndRemoveTask() }

        // Back goes back inside Bernard, otherwise hides him (he keeps running) instead of closing.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })

        pendingTalk = intent?.getBooleanExtra(EXTRA_TALK, false) == true
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)

        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT >= 33) needed += Manifest.permission.POST_NOTIFICATIONS
        val missing = needed.filter { !has(it) }
        if (missing.isEmpty()) { startBackgroundService(); askBatteryOnce() } else askPermissions.launch(missing.toTypedArray())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_TALK, false)) talk()
    }

    // Deliberately do NOT pause the WebView when going to the background: that's the whole point.
    override fun onPause() { super.onPause(); web.resumeTimers() }
    override fun onStop() { super.onStop(); web.resumeTimers() }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        if (Bus.talk != null) { Bus.talk = null; Bus.finish = null }
        stopService(Intent(this, BernudService::class.java))
        web.destroy()
        super.onDestroy()
    }

    private fun talk() {
        web.evaluateJavascript("window.bernudTalk ? (window.bernudTalk(), 'ok') : 'missing'", null)
    }

    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun startBackgroundService() {
        try { ContextCompat.startForegroundService(this, Intent(this, BernudService::class.java)) } catch (_: Exception) {}
    }

    // Samsung and others kill background apps aggressively: ask once to be left alone.
    @SuppressLint("BatteryLife")
    private fun askBatteryOnce() {
        val prefs = getSharedPreferences("bernud", MODE_PRIVATE)
        if (prefs.getBoolean("askedBattery", false)) return
        prefs.edit().putBoolean("askedBattery", true).apply()
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {}
    }
}
