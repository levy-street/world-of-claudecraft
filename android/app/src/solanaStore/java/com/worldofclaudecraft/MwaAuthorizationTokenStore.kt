package com.worldofclaudecraft

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MwaAuthorizationTokenStore(
    private val context: Context,
    private val preferencesName: String = PREFERENCES_NAME,
    private val keyAlias: String = KEY_ALIAS,
) {
    private val preferences: SharedPreferences
        get() = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

    @Synchronized
    fun load(): String? {
        val stored = preferences
        val hasEnvelope =
            stored.contains(VERSION_KEY) ||
                stored.contains(IV_KEY) ||
                stored.contains(CIPHERTEXT_KEY)
        if (!hasEnvelope) return null

        return try {
            val version = stored.getInt(VERSION_KEY, -1)
            val encodedIv = stored.getString(IV_KEY, null)
            val encodedCiphertext = stored.getString(CIPHERTEXT_KEY, null)
            if (
                version != ENVELOPE_VERSION ||
                encodedIv.isNullOrEmpty() ||
                encodedCiphertext.isNullOrEmpty()
            ) {
                clear()
                return null
            }

            val iv = decodeCanonicalBase64(encodedIv, MAX_ENCODED_IV_BYTES)
            val ciphertext =
                decodeCanonicalBase64(encodedCiphertext, MAX_ENCODED_CIPHERTEXT_BYTES)
            if (
                iv == null ||
                iv.size != GCM_IV_BYTES ||
                ciphertext == null ||
                ciphertext.size !in GCM_TAG_BYTES..MAX_CIPHERTEXT_BYTES
            ) {
                clear()
                return null
            }

            val key = existingKey()
            if (key == null) {
                clear()
                return null
            }
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.updateAAD(aad(version))
            val plaintext = cipher.doFinal(ciphertext)
            if (plaintext.isEmpty() || plaintext.size > MAX_TOKEN_BYTES) {
                clear()
                return null
            }
            val token = plaintext.toString(Charsets.UTF_8)
            if (!token.toByteArray(Charsets.UTF_8).contentEquals(plaintext)) {
                clear()
                null
            } else {
                token
            }
        } catch (_: Exception) {
            clear()
            null
        }
    }

    @Synchronized
    fun save(token: String): Boolean {
        if (token.isEmpty() || token.length > MAX_TOKEN_BYTES) {
            clear()
            return false
        }
        val plaintext = token.toByteArray(Charsets.UTF_8)
        if (plaintext.size > MAX_TOKEN_BYTES) {
            clear()
            return false
        }

        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            cipher.updateAAD(aad(ENVELOPE_VERSION))
            val iv = cipher.iv
            val ciphertext = cipher.doFinal(plaintext)
            if (
                iv.size != GCM_IV_BYTES ||
                ciphertext.size !in GCM_TAG_BYTES..MAX_CIPHERTEXT_BYTES
            ) {
                clear()
                return false
            }
            val committed =
                preferences
                    .edit()
                    .clear()
                    .putInt(VERSION_KEY, ENVELOPE_VERSION)
                    .putString(IV_KEY, Base64.encodeToString(iv, Base64.NO_WRAP))
                    .putString(
                        CIPHERTEXT_KEY,
                        Base64.encodeToString(ciphertext, Base64.NO_WRAP),
                    )
                    .commit()
            if (!committed) clear()
            committed
        } catch (_: Exception) {
            clear()
            false
        }
    }

    @Synchronized
    fun clear() {
        preferences.edit().clear().commit()
        try {
            val keyStore = keyStore()
            if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias)
        } catch (_: Exception) {
            // The encrypted record is already gone. A future save retries key creation.
        }
    }

    private fun existingKey(): SecretKey? {
        val keyStore = keyStore()
        return keyStore.getKey(keyAlias, null) as? SecretKey
    }

    private fun getOrCreateKey(): SecretKey {
        existingKey()?.let { return it }
        val generator =
            KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE,
            )
        generator.init(
            KeyGenParameterSpec
                .Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun keyStore(): KeyStore =
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private fun aad(version: Int): ByteArray =
        "${context.packageName}|$preferencesName|$keyAlias|$version".toByteArray(Charsets.UTF_8)

    private fun decodeCanonicalBase64(value: String, maxEncodedBytes: Int): ByteArray? {
        if (value.length > maxEncodedBytes) return null
        return try {
            val decoded = Base64.decode(value, Base64.NO_WRAP)
            if (Base64.encodeToString(decoded, Base64.NO_WRAP) == value) decoded else null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val PREFERENCES_NAME = "solana_mobile_auth"
        private const val KEY_ALIAS = "world_of_claudecraft_mwa_authorization"
        private const val ENVELOPE_VERSION = 1
        private const val VERSION_KEY = "version"
        private const val IV_KEY = "iv"
        private const val CIPHERTEXT_KEY = "ciphertext"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BITS = 128
        private const val GCM_TAG_BYTES = GCM_TAG_BITS / 8
        private const val MAX_TOKEN_BYTES = 16 * 1024
        private const val MAX_CIPHERTEXT_BYTES = MAX_TOKEN_BYTES + GCM_TAG_BYTES
        private const val MAX_ENCODED_IV_BYTES = 32
        private const val MAX_ENCODED_CIPHERTEXT_BYTES = 24 * 1024
    }
}
