package uk.bernud.wear

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import android.app.RemoteInput
import androidx.wear.input.RemoteInputIntentHelper
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import java.util.Locale

// Tap (or open from the tile / a key press) and talk: Bernard answers on screen and out loud.
class WearActivity : ComponentActivity() {
    companion object { const val EXTRA_TALK = "talk" }

    private lateinit var scroll: ScrollView
    private lateinit var status: TextView
    private lateinit var heard: TextView
    private lateinit var reply: TextView
    private var tts: TextToSpeech? = null
    private var busy = false
    private val prefs by lazy { getSharedPreferences("bernud", MODE_PRIVATE) }

    private val speech = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        val text = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            ?: data?.let { RemoteInput.getResultsFromIntent(it)?.getCharSequence("q")?.toString() }
        if (r.resultCode == RESULT_OK && !text.isNullOrBlank()) send(text.trim()) else status.text = "Tap to talk"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        tts = TextToSpeech(this) { ok -> if (ok == TextToSpeech.SUCCESS) tts?.language = Locale.UK }
        syncKey()
        if (savedInstanceState == null) scroll.postDelayed({ listen() }, 300)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_TALK, false)) listen()
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun buildUi() {
        scroll = ScrollView(this).apply { setBackgroundColor(Color.BLACK); isFillViewport = true; isFocusableInTouchMode = true }
        val pad = (resources.displayMetrics.widthPixels * 0.13).toInt()
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(pad, pad / 2, pad, pad)
        }
        col.addView(TextView(this).apply {
            text = "BERNARD"; setTextColor(0xFFFF3B4A.toInt()); letterSpacing = 0.2f
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f); typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
        })
        val mic = TextView(this).apply {
            text = "🎤"; gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFFC8102E.toInt()) }
            contentDescription = "Talk to Bernard"
            setOnClickListener { listen() }
        }
        col.addView(mic, LinearLayout.LayoutParams(dp(64), dp(64)).apply { topMargin = dp(6); bottomMargin = dp(6) })
        status = TextView(this).apply { setTextColor(0xFFB89A9C.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f); gravity = Gravity.CENTER; text = "Tap to talk" }
        heard = TextView(this).apply { setTextColor(0xFFB89A9C.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); gravity = Gravity.CENTER; typeface = Typeface.defaultFromStyle(Typeface.ITALIC) }
        reply = TextView(this).apply { setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0) }
        col.addView(status); col.addView(heard); col.addView(reply)
        scroll.addView(col, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
        scroll.requestFocus() // so the bezel / crown scrolls long answers
    }

    // The phone app shares the dashboard passcode over Wear OS; keep the latest copy.
    private fun syncKey() {
        try {
            val uri = Uri.Builder().scheme("wear").path("/bernud/key").build()
            Wearable.getDataClient(this).getDataItems(uri).addOnSuccessListener { items ->
                for (item in items) {
                    val k = DataMapItem.fromDataItem(item).dataMap.getString("key")
                    if (!k.isNullOrBlank()) prefs.edit().putString("dashKey", k).apply()
                }
                items.release()
            }
        } catch (_: Exception) {}
    }

    private fun listen() {
        if (busy) return
        tts?.stop()
        status.text = "Listening…"
        val voice = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask Bernard")
        try { speech.launch(voice) }
        catch (_: ActivityNotFoundException) {
            // No speech app on the watch: use Wear OS's own input screen (voice or keyboard).
            val i = RemoteInputIntentHelper.createActionRemoteInputIntent()
            RemoteInputIntentHelper.putRemoteInputsExtra(i, listOf(RemoteInput.Builder("q").setLabel("Ask Bernard").build()))
            try { speech.launch(i) } catch (_: Exception) { status.text = "This watch has no voice input" }
        }
    }

    private fun send(text: String) {
        busy = true
        heard.text = "“$text”"
        reply.text = ""
        status.text = "Thinking…"
        Thread {
            val answer = BrainClient.ask(applicationContext, text)
            runOnUiThread {
                busy = false
                status.text = "Tap to talk again"
                reply.text = answer
                scroll.scrollTo(0, 0)
                try { getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE)) } catch (_: Exception) {}
                tts?.speak(answer, TextToSpeech.QUEUE_FLUSH, null, "bernard")
            }
        }.start()
    }
}
