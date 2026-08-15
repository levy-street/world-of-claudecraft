package com.worldofclaudecraft

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyMwaAuthorizationCleanupTest {
    @Test
    fun acceptsOnlyACommittedRemoval() {
        var calls = 0

        assertTrue(
            removeLegacyMwaAuthorizationToken {
                calls += 1
                true
            },
        )
        assertFalse(
            removeLegacyMwaAuthorizationToken {
                calls += 1
                false
            },
        )
        assertFalse(
            removeLegacyMwaAuthorizationToken {
                calls += 1
                throw IllegalStateException("storage unavailable")
            },
        )
        assertTrue(calls == 3)
    }
}
