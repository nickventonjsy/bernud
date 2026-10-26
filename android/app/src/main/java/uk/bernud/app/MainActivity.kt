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
import android.os.VibrationEffect
import android.os.Vibrator
import android.webkit.JavascriptInterface
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
    private lateinit var free: FreeVoice
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

        free = FreeVoice(this) { code -> runOnUiThread { web.evaluateJavascript(code, null) } }
        web.addJavascriptInterface(Bridge(), "BernudApp")
        Bus.talk = { talk() }
        Bus.wake = {
            try { getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE)) } catch (_: Exception) {}
            web.evaluateJavascript("window.bernudStart && window.bernudStart()", null)
        }
        Bus.finish = { finishAndRemoveTask() }
        Bus.endTalk = { web.evaluateJavascript("window.bernudEnd && window.bernudEnd()", null) }

        // Back goes back inside Bernard, otherwise hides him (he keeps running) instead of closing.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })

        pendingTalk = intent?.getBooleanExtra(EXTRA_TALK, false) == true
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)

        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA, Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE)
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
        Bus.talk = null; Bus.wake = null; Bus.finish = null; Bus.endTalk = null
        stopService(Intent(this, BernudService::class.java))
        free.destroy()
        web.destroy()
        super.onDestroy()
    }

    private fun talk() {
        web.evaluateJavascript("window.bernudTalk ? (window.bernudTalk(), 'ok') : 'missing'", null)
    }

    // Lets the dashboard tell the app when a conversation starts and ends (the wake word gives up the mic meanwhile).
    inner class Bridge {
        @JavascriptInterface fun conversationStarted() { runOnUiThread { WakeWord.conversationStarted(); AudioRoute.conversationStarted(this@MainActivity) } }
        @JavascriptInterface fun conversationEnded() { runOnUiThread { WakeWord.conversationEnded(); AudioRoute.conversationEnded(this@MainActivity) } }
        // Free mode: phone listens and speaks itself; the wake word just gives up the mic meanwhile.
        @JavascriptInterface fun freeStarted() { runOnUiThread { WakeWord.conversationStarted() } }
        @JavascriptInterface fun freeEnded() { runOnUiThread { free.stopListening(); free.stopSpeaking(); WakeWord.conversationEnded() } }
        @JavascriptInterface fun listenOnce() { free.listenOnce() }
        @JavascriptInterface fun stopListening() { free.stopListening() }
        @JavascriptInterface fun speak(text: String) { free.speak(text) }
        @JavascriptInterface fun stopSpeaking() { free.stopSpeaking() }
        @JavascriptInterface fun ttsVoices() { free.listVoices() }
        @JavascriptInterface fun setTtsVoice(name: String, pitch: Float, rate: Float) { free.setVoice(name, pitch, rate) }
        @JavascriptInterface fun wakeWordStatus(): String = WakeWord.status
        @JavascriptInterface fun phoneStatus(): String = Bus.phoneStatus?.invoke() ?: "service not running"
        @JavascriptInterface fun setPhoneConfig(topic: String, secret: String) {
            val prefs = getSharedPreferences("bernud", MODE_PRIVATE)
            if (prefs.getString("cmdTopic", null) == topic && prefs.getString("cmdSecret", null) == secret) return
            prefs.edit().putString("cmdTopic", topic).putString("cmdSecret", secret).apply()
            runOnUiThread { Bus.reloadCommands?.invoke() }
        }
        @JavascriptInterface fun setWakeWord(on: Boolean) {
            runOnUiThread {
                getSharedPreferences("bernud", MODE_PRIVATE).edit().putBoolean("wakeWord", on).apply()
                if (on) WakeWord.start(this@MainActivity) else WakeWord.stop()
            }
        }
    }

    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun startBackgroundService() {
        try { ContextCompat.startForegroundService(this, Intent(this, BernudService::class.java)) } catch (_: Exception) {}
    }

    // Phone control needs a few switches Android only lets the user flip in Settings. Ask once each, one at a time.
    private fun askSpecialPermissions() {
        val prefs = getSharedPreferences("bernud", MODE_PRIVATE)
        val nm = getSystemService(android.app.NotificationManager::class.java)
        val steps = listOf(
            Triple("askedOverlay", !Settings.canDrawOverlays(this)) {
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            } to "Let Bernard open apps for you (WhatsApp calls, websites, apps).\n\nOn the next screen, switch on \"Allow display over other apps\".",
            Triple("askedDnd", !nm.isNotificationPolicyAccessGranted) {
                Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            } to "Let Bernard switch Do Not Disturb on and off.\n\nOn the next screen, find Bernard and switch it on.",
            Triple("askedWrite", !Settings.System.canWrite(this)) {
                Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:$packageName"))
            } to "Let Bernard change your screen brightness.\n\nOn the next screen, switch on \"Allow modifying system settings\".",
        )
        val next = steps.firstOrNull { (t, _) -> t.second && !prefs.getBoolean(t.first, false) } ?: return
        val (t, message) = next
        prefs.edit().putBoolean(t.first, true).apply()
        android.app.AlertDialog.Builder(this)
            .setTitle("Bernard phone control")
            .setMessage(message)
            .setPositiveButton("Allow") { _, _ -> try { startActivity(t.third()) } catch (_: Exception) {} }
            .setNegativeButton("Not now") { _, _ -> askSpecialPermissions() }
            .show()
    }

    override fun onResume() {
        super.onResume()
        if (has(Manifest.permission.RECORD_AUDIO)) web.postDelayed({ askSpecialPermissions() }, 1200)
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
