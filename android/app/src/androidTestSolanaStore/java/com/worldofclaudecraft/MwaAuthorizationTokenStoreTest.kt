package com.worldofclaudecraft

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MwaAuthorizationTokenStoreTest {
    private lateinit var context: Context
    private lateinit var preferencesName: String
    private lateinit var keyAlias: String
    private lateinit var store: MwaAuthorizationTokenStore

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        preferencesName = "mwa_auth_test_$suffix"
        keyAlias = "mwa_auth_test_$suffix"
        store = MwaAuthorizationTokenStore(context, preferencesName, keyAlias)
    }

    @After
    fun tearDown() {
        store.clear()
    }

    @Test
    fun roundTripStoresOnlyCiphertextWithFreshInitializationVectors() {
        val token = "reusable-mwa-authorization-token"

        assertTrue(store.save(token))
        val firstEnvelope =
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).all.toMap()
        assertEquals(token, store.load())
        assertFalse(firstEnvelope.values.any { it.toString().contains(token) })

        assertTrue(store.save(token))
        val secondEnvelope =
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).all.toMap()
        assertNotEquals(firstEnvelope["iv"], secondEnvelope["iv"])
        assertNotEquals(firstEnvelope["ciphertext"], secondEnvelope["ciphertext"])
        assertEquals(token, store.load())
    }

    @Test
    fun tamperedCiphertextFailsClosedAndClearsTheEnvelopeAndKey() {
        assertTrue(store.save("reusable-mwa-authorization-token"))
        context
            .getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
            .edit()
            .putString("ciphertext", "dGFtcGVyZWQ=")
            .commit()

        assertNull(store.load())
        assertTrue(
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).all.isEmpty(),
        )
        assertFalse(androidKeyStore().containsAlias(keyAlias))
    }

    @Test
    fun missingKeyFailsClosedWithoutGeneratingAReplacementForDecryption() {
        assertTrue(store.save("reusable-mwa-authorization-token"))
        androidKeyStore().deleteEntry(keyAlias)

        assertNull(store.load())
        assertTrue(
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).all.isEmpty(),
        )
        assertFalse(androidKeyStore().containsAlias(keyAlias))
    }

    @Test
    fun malformedVersionAndOversizedTokenFailClosed() {
        assertTrue(store.save("reusable-mwa-authorization-token"))
        context
            .getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
            .edit()
            .putInt("version", 99)
            .commit()

        assertNull(store.load())
        assertTrue(
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).all.isEmpty(),
        )
        assertFalse(store.save("x".repeat(16 * 1024 + 1)))
        assertTrue(
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).all.isEmpty(),
        )
    }

    @Test
    fun aadPreventsMovingAnEnvelopeToAnotherPreferencesFile() {
        assertTrue(store.save("reusable-mwa-authorization-token"))
        val source =
            context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).all
        val otherPreferencesName = "${preferencesName}_other"
        val otherPreferences =
            context.getSharedPreferences(otherPreferencesName, Context.MODE_PRIVATE)
        otherPreferences
            .edit()
            .putInt("version", source["version"] as Int)
            .putString("iv", source["iv"] as String)
            .putString("ciphertext", source["ciphertext"] as String)
            .commit()
        val otherStore =
            MwaAuthorizationTokenStore(context, otherPreferencesName, keyAlias)

        assertNull(otherStore.load())
        assertTrue(otherPreferences.all.isEmpty())
    }

    private fun androidKeyStore(): KeyStore =
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}
