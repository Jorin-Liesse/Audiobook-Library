package com.sapodillagames.googledrive

import android.accounts.Account
import android.app.Activity
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

private const val APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata"

@InvokeArg
class AuthorizeArgs {
    var interactive: Boolean = false
    var email: String? = null
}

@InvokeArg
class InvalidateArgs { lateinit var accessToken: String }

// A headless fragment owns the Activity Result launcher across the Google consent UI.
// Google Play Services manages token renewal. No refresh token or client secret is stored.
class DriveAuthorizationFragment : Fragment() {
    private var pending: Invoke? = null
    private val consent = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        try {
            resolve(Identity.getAuthorizationClient(requireActivity()).getAuthorizationResultFromIntent(result.data))
        } catch (_: Exception) {
            reject("Google Drive access was not granted. Try connecting again.")
        }
    }

    fun authorize(invoke: Invoke, args: AuthorizeArgs) {
        if (pending != null) { invoke.reject("Google sign-in is already in progress."); return }
        pending = invoke
        val request = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(APP_DATA_SCOPE)))
        args.email?.takeIf { it.isNotBlank() }?.let { request.setAccount(Account(it, "com.google")) }
        Identity.getAuthorizationClient(requireActivity()).authorize(request.build())
            .addOnSuccessListener { result ->
                if (pending == null || !isAdded) return@addOnSuccessListener
                try {
                    if (result.hasResolution()) {
                        if (!args.interactive) reject("Reconnect Google Drive to continue syncing.")
                        else consent.launch(IntentSenderRequest.Builder(requireNotNull(result.pendingIntent).intentSender).build())
                    } else resolve(result)
                } catch (_: Exception) { reject("Google sign-in could not start. Try connecting again.") }
            }
            .addOnFailureListener { reject("Google sign-in failed. Check your connection and Android OAuth configuration.") }
    }

    private fun resolve(result: AuthorizationResult) {
        val token = result.accessToken
        if (token.isNullOrBlank() || !result.grantedScopes.contains(APP_DATA_SCOPE)) {
            reject("Google Drive app-data access was not granted.")
            return
        }
        val response = JSObject()
        response.put("accessToken", token)
        response.put("expiresIn", 3600)
        pending?.resolve(response)
        pending = null
    }
    private fun reject(message: String) { pending?.reject(message); pending = null }
    override fun onDestroy() {
        reject("Google sign-in was interrupted. Try connecting again.")
        super.onDestroy()
    }
}

@TauriPlugin
class GoogleDrivePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun invalidate(invoke: Invoke) {
        val args = invoke.parseArgs(InvalidateArgs::class.java)
        Identity.getAuthorizationClient(activity).clearToken(ClearTokenRequest.builder().setToken(args.accessToken).build())
            .addOnSuccessListener { invoke.resolve() }
            .addOnFailureListener { invoke.reject("Could not clear expired Google authorization.") }
    }

    @Command
    fun authorize(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val manager = (activity as FragmentActivity).supportFragmentManager
                val fragment = manager.findFragmentByTag("google-drive-authorization") as? DriveAuthorizationFragment
                    ?: DriveAuthorizationFragment().also { manager.beginTransaction().add(it, "google-drive-authorization").commitNow() }
                fragment.authorize(invoke, invoke.parseArgs(AuthorizeArgs::class.java))
            } catch (_: Exception) { invoke.reject("Google sign-in could not start. Try connecting again.") }
        }
    }
}
