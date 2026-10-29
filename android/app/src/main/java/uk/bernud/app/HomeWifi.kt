package uk.bernud.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL

// Arrival greeting: tells the server when the phone joins or loses Wi-Fi. The server decides whether it's the house's
// Wi-Fi by comparing the phone's internet address with the one saved from the dashboard ("This is my home Wi-Fi"),
// so no location permission is needed. Runs while Bernard's background service is running.
object HomeWifi {
    private const val SERVER = "https://bernud-server.onrender.com"
    private var cb: ConnectivityManager.NetworkCallback? = null
    private val main = Handler(Looper.getMainLooper())
    private var lastEvent = ""
    private var lastAt = 0L

    private fun post(ctx: Context, event: String, network: Network?) {
        val secret = ctx.getSharedPreferences("bernud", Context.MODE_PRIVATE).getString("cmdSecret", null) ?: return
        val now = System.currentTimeMillis()
        if (event == lastEvent && now - lastAt < 60_000) return   // Wi-Fi flapping
        lastEvent = event; lastAt = now
        Thread {
            try {
                val url = URL("$SERVER/home/event?e=$event")
                // Send a "joined Wi-Fi" report over that Wi-Fi, so the server sees the house's address.
                val c = (if (network != null) network.openConnection(url) else url.openConnection()) as HttpURLConnection
                c.requestMethod = "POST"; c.connectTimeout = 15_000; c.readTimeout = 20_000
                c.setRequestProperty("x-phone-key", secret)
                c.doOutput = true; c.outputStream.use { it.write(ByteArray(0)) }
                Log.i("bernud", "home wifi $event: ${c.responseCode}")
                c.disconnect()
            } catch (e: Exception) { Log.w("bernud", "home wifi $event: ${e.message}") }
        }.start()
    }

    fun start(ctx: Context) {
        if (cb != null) return
        val app = ctx.applicationContext
        val cm = app.getSystemService(ConnectivityManager::class.java) ?: return
        val req = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Give the connection a few seconds to settle before reporting.
                main.postDelayed({ post(app, "wifi", network) }, 5_000)
            }
            override fun onLost(network: Network) { main.postDelayed({ post(app, "wifi_lost", null) }, 3_000) }
        }
        try { cm.registerNetworkCallback(req, callback); cb = callback } catch (e: Exception) { Log.w("bernud", "home wifi: ${e.message}") }
    }

    fun stop(ctx: Context) {
        val c = cb ?: return
        try { ctx.applicationContext.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(c) } catch (_: Exception) {}
        cb = null
    }
}
