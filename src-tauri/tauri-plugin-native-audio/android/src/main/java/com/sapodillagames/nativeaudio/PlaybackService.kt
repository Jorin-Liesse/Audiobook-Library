package com.sapodillagames.nativeaudio

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.common.util.UnstableApi
import app.tauri.plugin.JSObject
import org.json.JSONObject

@UnstableApi
class PlaybackService : MediaSessionService() {
    companion object {
        var instance: PlaybackService? = null
            private set
        private const val PREFS = "audiobook-playback"

        fun status(context: Context): JSObject {
            instance?.let { return it.snapshot() }
            val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString("state", null)
            val result = JSObject()
            if (saved != null) {
                val json = JSONObject(saved)
                for (key in json.keys()) result.put(key, json.get(key))
            }
            // A saved position does not mean a service is still playing.
            result.put("active", false)
            result.put("playing", false)
            return result
        }

        fun clearSaved(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        }
    }

    lateinit var player: ExoPlayer
        private set
    private var session: MediaSession? = null
    private val handler = Handler(Looper.getMainLooper())
    private val checkpoint = object : Runnable {
        override fun run() {
            save()
            handler.postDelayed(this, 5000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .setSeekBackIncrementMs(15000)
            .setSeekForwardIncrementMs(30000)
            .build()
        val builder = MediaSession.Builder(this, player)
        packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
            intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            builder.setSessionActivity(PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        session = builder.build()
        instance = this
        player.addListener(object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) { save() }
        })
        handler.post(checkpoint)
    }

    fun snapshot(): JSObject {
        val result = JSObject()
        val item = player.currentMediaItem
        result.put("active", item != null)
        result.put("bookKey", item?.mediaMetadata?.extras?.getString("bookKey"))
        result.put("index", player.currentMediaItemIndex.coerceAtLeast(0))
        result.put("count", player.mediaItemCount)
        result.put("position", player.currentPosition.coerceAtLeast(0) / 1000.0)
        result.put("duration", player.duration.takeIf { it > 0 }?.div(1000.0) ?: 0.0)
        result.put("playing", player.playWhenReady && player.playbackState != Player.STATE_ENDED
            && player.playerError == null)
        result.put("ended", player.playbackState == Player.STATE_ENDED)
        result.put("error", player.playerError?.message)
        result.put("updatedAt", System.currentTimeMillis())
        return result
    }

    fun save() {
        if (player.currentMediaItem == null) return
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("state", snapshot().toString()).apply()
    }

    fun stopPlayback() {
        save()
        player.stop()
        player.clearMediaItems()
        clearSaved(this)
        stopSelf()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        save()
        // Swiping away the activity must not interrupt an actively playing book.
        if (!player.playWhenReady || player.mediaItemCount == 0
            || player.playbackState == Player.STATE_ENDED) stopSelf()
    }

    override fun onDestroy() {
        save()
        handler.removeCallbacksAndMessages(null)
        instance = null
        session?.release()
        player.release()
        super.onDestroy()
    }
}
