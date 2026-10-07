package com.sapodillagames.nativeaudio

import android.app.Activity
import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject
import java.util.concurrent.Executor

@InvokeArg
class TrackArgs {
    lateinit var location: String
    lateinit var name: String
}

@InvokeArg
class LoadArgs {
    lateinit var bookKey: String
    lateinit var title: String
    var author: String = ""
    var tracks: List<TrackArgs> = emptyList()
    var index: Int = 0
    var position: Double = 0.0
}

@InvokeArg
class SeekArgs { var position: Double = 0.0 }

@UnstableApi
@TauriPlugin
class NativeAudioPlugin(private val activity: Activity) : Plugin(activity) {
    private var connection: ListenableFuture<MediaController>? = null
    private val mainExecutor = Executor { action -> activity.runOnUiThread(action) }

    private fun documentUri(location: String): Uri {
        val stored = JSONObject(location)
        val uri = Uri.parse(stored.getString("uri"))
        require(uri.scheme == "content") { "Expected a library document URI" }
        val tree = stored.optString("documentTopTreeUri", "")
            .ifEmpty { stored.optString("document_top_tree_uri", "") }
        return if (tree.isNotEmpty() && tree != "null") {
            DocumentsContract.buildDocumentUriUsingTree(Uri.parse(tree), DocumentsContract.getDocumentId(uri))
        } else uri
    }

    private fun withController(invoke: Invoke, action: (MediaController) -> Unit) {
        val future = connection ?: MediaController.Builder(activity.applicationContext,
            SessionToken(activity.applicationContext, ComponentName(activity, PlaybackService::class.java)))
            .setListener(object : MediaController.Listener {
                override fun onDisconnected(controller: MediaController) {
                    connection = null
                    controller.release()
                }
            })
            .buildAsync().also { connection = it }
        future.addListener({
            try {
                val controller = future.get()
                if (!controller.isConnected) {
                    connection = null
                    MediaController.releaseFuture(future)
                    invoke.reject("The audio service disconnected. Tap Play to reconnect.")
                    return@addListener
                }
                action(controller)
                invoke.resolve(PlaybackService.status(activity))
            } catch (error: Exception) {
                connection = null
                MediaController.releaseFuture(future)
                invoke.reject(error.message ?: "The audio service could not start")
            }
        }, mainExecutor)
    }

    @Command
    fun load(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(LoadArgs::class.java)
            require(args.tracks.isNotEmpty() && args.index in args.tracks.indices)
            require(args.position.isFinite() && args.position >= 0)
            // Queue the entire book natively: chapter transitions never depend on JavaScript.
            val items = args.tracks.mapIndexed { index, track ->
                val extras = Bundle().apply { putString("bookKey", args.bookKey) }
                MediaItem.Builder().setMediaId(args.bookKey + ":" + index)
                    .setUri(documentUri(track.location))
                    .setMediaMetadata(MediaMetadata.Builder()
                        .setTitle(args.title)
                        .setArtist(args.author)
                        .setSubtitle(track.name)
                        .setExtras(extras).build()).build()
            }
            withController(invoke) { _ ->
                // Use the local player so the returned status includes this command immediately.
                val player = requireNotNull(PlaybackService.instance).player
                player.setMediaItems(items, args.index, (args.position * 1000).toLong())
                player.prepare()
                player.play()
            }
        } catch (error: Exception) {
            invoke.reject(error.message ?: "The audiobook could not be opened")
        }
    }

    @Command
    fun status(invoke: Invoke) { invoke.resolve(PlaybackService.status(activity)) }

    @Command
    fun play(invoke: Invoke) {
        val player = PlaybackService.instance?.player
        if (player == null || player.mediaItemCount == 0) {
            invoke.reject("Load an audiobook before playing")
            return
        }
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.play()
        invoke.resolve(PlaybackService.status(activity))
    }

    @Command
    fun pause(invoke: Invoke) {
        PlaybackService.instance?.player?.pause()
        invoke.resolve(PlaybackService.status(activity))
    }

    @Command
    fun seek(invoke: Invoke) {
        val args = invoke.parseArgs(SeekArgs::class.java)
        if (!args.position.isFinite() || args.position < 0) {
            invoke.reject("Invalid playback position")
            return
        }
        PlaybackService.instance?.player?.let { player ->
            val target = (args.position * 1000).toLong()
            player.seekTo(if (player.duration > 0) target.coerceAtMost(player.duration) else target)
        }
        invoke.resolve(PlaybackService.status(activity))
    }

    @Command
    fun stop(invoke: Invoke) {
        PlaybackService.instance?.stopPlayback()
        PlaybackService.clearSaved(activity)
        connection?.let { MediaController.releaseFuture(it) }
        connection = null
        invoke.resolve(PlaybackService.status(activity))
    }

    override fun onDestroy(activity: AppCompatActivity) {
        connection?.let { MediaController.releaseFuture(it) }
        connection = null
        // The service owns playback independently of the activity/WebView.
    }
}
