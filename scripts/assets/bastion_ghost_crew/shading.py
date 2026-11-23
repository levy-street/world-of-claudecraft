"""Shared drowned PBR surfaces with restrained spectral accents."""
import anatomy as A
BASE=A.source('shading')
KINDS=BASE.KINDS
shade=BASE.shade
uv_boost=BASE.uv_boost
EMIT_STRENGTH=2.5
GLOWS={'glow_eye':((.27,.95,.78),5.0,'GhostEyes'),
       'glow_soul':((.08,.39,.32),1.2,'GhostSoul'),
       'glow_wisp':((.055,.18,.16),.7,'GhostWisps')}
