# Vault signed-reagent masterwork reworded guide keys

The change that lets a signed reagent banked in the Materials Vault feed the
masterwork signed-reagent bonus rewords existing English Guide values.
Translation status cannot detect this kind of drift, so the next maintainer
locale pass must review and refill every key below.

| Existing key | Why every locale needs a fresh translation |
|---|---|
| `guide.profPages.econ.provenanceBody` | The masterwork signed-reagent bonus now counts a signed copy held in the Materials Vault (wherever crafts can draw on it), not only one held at the bench. |
| `guide.profPages.econ.provenanceBodyUndiscounted` | The same correction on the undiscounted-reagent variant of the body. |
| `guide.profPages.faq.a4` | The same correction in the signed-materials answer. |

Refresh every maintained locale overlay under `src/ui/i18n.locales/` that
carries a translation for these keys; locales that fall back to English already
render the new wording.

This registry records required release work only. It does not claim that any
translation is current.
