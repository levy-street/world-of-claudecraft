package com.worldofclaudecraft

import android.content.Context
import android.net.Uri
import android.os.Build
import android.util.Base64
import com.funkatronics.encoders.Base58
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "NativeSolanaMobile")
class NativeSolanaMobilePlugin : Plugin() {
    private class MissingAuthorizedAccountException : IllegalStateException()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var activityResultSender: ActivityResultSender
    private lateinit var tokenStore: MwaAuthorizationTokenStore
    private var secureStorageReady = false
    private val walletAdapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse("https://worldofclaudecraft.com"),
            iconUri = Uri.parse("favicon.svg"),
            identityName = "World of ClaudeCraft",
        ),
    )

    override fun load() {
        super.load()
        activityResultSender = ActivityResultSender(activity)
        tokenStore = MwaAuthorizationTokenStore(context)
        val legacyTokenRemoved =
            removeLegacyMwaAuthorizationToken {
                walletPreferences().edit().remove(LEGACY_AUTH_TOKEN_KEY).commit()
            }
        if (!legacyTokenRemoved) {
            walletAdapter.authToken = null
            tokenStore.clear()
            walletPreferences().edit().remove(WALLET_ADDRESS_KEY).commit()
            return
        }
        secureStorageReady = true
        walletAdapter.authToken = tokenStore.load()
        if (walletAdapter.authToken == null) {
            walletPreferences().edit().remove(WALLET_ADDRESS_KEY).commit()
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val result = JSObject()
        result.put("distribution", BuildConfig.SOLANA_MOBILE_DISTRIBUTION)
        result.put("device", if (isSeeker()) "seeker" else "other")
        result.put("mwaAvailable", solanaMobileAllowed())
        call.resolve(result)
    }

    @PluginMethod
    fun current(call: PluginCall) {
        val address = if (solanaMobileAllowed()) {
            walletPreferences().getString(WALLET_ADDRESS_KEY, null)
        } else {
            null
        }
        call.resolve(JSObject().put("address", address))
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        if (!requireSolanaMobile(call)) return
        scope.launch {
            when (val result = walletAdapter.connect(activityResultSender)) {
                is TransactionResult.Success -> {
                    val account = result.authResult.accounts.firstOrNull()
                    if (account == null) {
                        clearAuthorizationState()
                        call.reject("Wallet returned no account", "MWA_NO_ACCOUNT")
                        return@launch
                    }
                    if (!persistAuthToken()) {
                        call.reject(
                            "Wallet authorization could not be stored securely",
                            "MWA_SECURE_STORAGE_FAILED",
                        )
                        return@launch
                    }
                    val address = Base58.encodeToString(account.publicKey)
                    walletPreferences().edit().putString(WALLET_ADDRESS_KEY, address).commit()
                    call.resolve(JSObject().put("address", address))
                }
                is TransactionResult.NoWalletFound ->
                    call.reject("No Mobile Wallet Adapter wallet found", "MWA_NO_WALLET")
                is TransactionResult.Failure ->
                    call.reject("Wallet connection failed", "MWA_CONNECT_FAILED", result.e)
            }
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        if (!requireSolanaMobile(call)) return
        scope.launch {
            when (val result = walletAdapter.disconnect(activityResultSender)) {
                is TransactionResult.Success -> {
                    walletAdapter.authToken = null
                    tokenStore.clear()
                    walletPreferences().edit().remove(WALLET_ADDRESS_KEY).commit()
                    call.resolve()
                }
                is TransactionResult.NoWalletFound -> {
                    walletAdapter.authToken = null
                    tokenStore.clear()
                    walletPreferences().edit().remove(WALLET_ADDRESS_KEY).commit()
                    call.resolve()
                }
                is TransactionResult.Failure ->
                    call.reject("Wallet disconnect failed", "MWA_DISCONNECT_FAILED", result.e)
            }
        }
    }

    @PluginMethod
    fun signMessage(call: PluginCall) {
        if (!requireSolanaMobile(call)) return
        val message = call.getString("message")
        if (message.isNullOrEmpty()) {
            call.reject("Missing message", "MWA_MISSING_MESSAGE")
            return
        }
        scope.launch {
            val result = walletAdapter.transact(activityResultSender) { authResult ->
                val account = authResult.accounts.firstOrNull()
                    ?: throw MissingAuthorizedAccountException()
                signMessagesDetached(
                    arrayOf(message.toByteArray(Charsets.UTF_8)),
                    arrayOf(account.publicKey),
                )
            }
            when (result) {
                is TransactionResult.Success -> {
                    persistAuthToken()
                    val signature = result.payload
                        .messages
                        ?.firstOrNull()
                        ?.signatures
                        ?.firstOrNull()
                    if (signature == null) {
                        call.reject("Wallet returned no signature", "MWA_NO_SIGNATURE")
                        return@launch
                    }
                    call.resolve(JSObject().put("signature", Base58.encodeToString(signature)))
                }
                is TransactionResult.NoWalletFound ->
                    call.reject("No Mobile Wallet Adapter wallet found", "MWA_NO_WALLET")
                is TransactionResult.Failure -> {
                    if (result.e is MissingAuthorizedAccountException) {
                        clearAuthorizationState()
                        call.reject("Wallet returned no account", "MWA_NO_ACCOUNT")
                    } else {
                        call.reject("Message signing failed", "MWA_SIGN_FAILED", result.e)
                    }
                }
            }
        }
    }

    @PluginMethod
    fun signAndSendTransaction(call: PluginCall) {
        if (!requireSolanaMobile(call)) return
        val encoded = call.getString("transaction")
        if (encoded.isNullOrEmpty()) {
            call.reject("Missing transaction", "MWA_MISSING_TRANSACTION")
            return
        }
        val transaction = try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            call.reject("Invalid transaction encoding", "MWA_INVALID_TRANSACTION", error)
            return
        }
        scope.launch {
            val result = walletAdapter.transact(activityResultSender) { authResult ->
                authResult.accounts.firstOrNull()
                    ?: throw MissingAuthorizedAccountException()
                signAndSendTransactions(arrayOf(transaction))
            }
            when (result) {
                is TransactionResult.Success -> {
                    persistAuthToken()
                    val signature = result.payload.signatures.firstOrNull()
                    if (signature == null) {
                        call.reject("Wallet returned no transaction signature", "MWA_NO_SIGNATURE")
                        return@launch
                    }
                    call.resolve(JSObject().put("signature", Base58.encodeToString(signature)))
                }
                is TransactionResult.NoWalletFound ->
                    call.reject("No Mobile Wallet Adapter wallet found", "MWA_NO_WALLET")
                is TransactionResult.Failure -> {
                    if (result.e is MissingAuthorizedAccountException) {
                        clearAuthorizationState()
                        call.reject("Wallet returned no account", "MWA_NO_ACCOUNT")
                    } else {
                        call.reject(
                            "Transaction signing failed",
                            "MWA_TRANSACTION_FAILED",
                            result.e,
                        )
                    }
                }
            }
        }
    }

    private fun clearAuthorizationState() {
        walletAdapter.authToken = null
        tokenStore.clear()
        walletPreferences().edit().remove(WALLET_ADDRESS_KEY).commit()
    }

    private fun persistAuthToken(): Boolean {
        val token = walletAdapter.authToken
        if (token.isNullOrEmpty()) {
            tokenStore.clear()
            walletPreferences().edit().remove(WALLET_ADDRESS_KEY).commit()
            return false
        } else {
            if (tokenStore.save(token)) return true
            walletAdapter.authToken = null
            walletPreferences().edit().remove(WALLET_ADDRESS_KEY).commit()
            return false
        }
    }

    private fun walletPreferences() =
        context.getSharedPreferences(AUTH_PREFERENCES_NAME, Context.MODE_PRIVATE)

    private fun requireSolanaMobile(call: PluginCall): Boolean {
        if (solanaMobileAllowed()) return true
        call.reject("Solana Mobile is unavailable for this build or device", "MWA_UNAVAILABLE")
        return false
    }

    private fun solanaMobileAllowed(): Boolean =
        BuildConfig.SOLANA_MOBILE_DISTRIBUTION == "solana-dapp-store" &&
            isSeeker() &&
            secureStorageReady

    private fun isSeeker(): Boolean =
        Build.MODEL.equals("Seeker", ignoreCase = true) &&
            Build.BRAND.equals("solanamobile", ignoreCase = true) &&
            Build.MANUFACTURER.equals("Solana Mobile Inc.", ignoreCase = true)

    companion object {
        private const val AUTH_PREFERENCES_NAME = "solana_mobile"
        private const val LEGACY_AUTH_TOKEN_KEY = "solana_mobile_auth_token"
        private const val WALLET_ADDRESS_KEY = "solana_mobile_wallet_address"
    }
}
