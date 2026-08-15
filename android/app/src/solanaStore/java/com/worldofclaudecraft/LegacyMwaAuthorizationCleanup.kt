package com.worldofclaudecraft

internal fun removeLegacyMwaAuthorizationToken(remove: () -> Boolean): Boolean =
    try {
        remove()
    } catch (_: Exception) {
        false
    }
