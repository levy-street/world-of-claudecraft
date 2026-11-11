<?php
if ( !defined( 'MEDIAWIKI' ) ) {
	exit;
}

$wgSitename = 'World of Claudecraft Wiki';
$wgMetaNamespace = 'World_of_Claudecraft';
$wgScriptPath = '/wiki';
$wgServer = getenv( 'MEDIAWIKI_SERVER' ) ?: 'http://localhost:8080';
$wgArticlePath = "$wgScriptPath/index.php/$1";
$wgUsePathInfo = true;
$wgResourceBasePath = $wgScriptPath;

$wgLogos = [
	'1x' => "$wgScriptPath/resources/assets/woc-logo-square.webp",
	'icon' => "$wgScriptPath/resources/assets/woc-logo-square.webp",
];

$wgEnableEmail = false;
$wgEnableUserEmail = false;

$wgDBtype = 'mysql';
$wgDBserver = getenv( 'MEDIAWIKI_DB_HOST' ) ?: 'mediawiki-db';
$wgDBname = getenv( 'MEDIAWIKI_DB_NAME' ) ?: 'mediawiki';
$wgDBuser = getenv( 'MEDIAWIKI_DB_USER' ) ?: 'mediawiki';
$wgDBpassword = getenv( 'MEDIAWIKI_DB_PASSWORD' ) ?: 'mediawiki';
$wgDBprefix = '';
$wgDBTableOptions = 'ENGINE=InnoDB, DEFAULT CHARSET=binary';

$wgMainCacheType = CACHE_ACCEL;
$wgMemCachedServers = [];

$wgSecretKey = getenv( 'MEDIAWIKI_SECRET_KEY' ) ?: 'local-dev-change-me-world-of-claudecraft';
$wgAuthenticationTokenVersion = '1';
$wgUpgradeKey = getenv( 'MEDIAWIKI_UPGRADE_KEY' ) ?: 'local-dev-upgrade-key';

$wgLanguageCode = 'en';
$wgLocaltimezone = 'UTC';
$wgEmergencyContact = 'admin@localhost';
$wgPasswordSender = 'admin@localhost';

$wgEnableUploads = true;
$wgUseImageMagick = false;
$wgImageMagickConvertCommand = '/usr/bin/convert';

$wgDefaultSkin = 'vector-2022';
$wgVectorDefaultSkinVersion = '2';

$wgGroupPermissions['*']['edit'] = false;
$wgGroupPermissions['*']['createaccount'] = false;
$wgGroupPermissions['user']['edit'] = true;

$wgDefaultUserOptions['usebetatoolbar'] = 1;
$wgDefaultUserOptions['usenewrc'] = 1;
$wgDefaultUserOptions['vector-theme'] = 'os';
$wgDefaultUserOptions['vector-toc-pinned'] = 1;
$wgDefaultUserOptions['vector-page-tools-pinned'] = 1;

$wgAllowSiteCSSOnRestrictedPages = true;
$wgRawHtml = false;

wfLoadSkin( 'Vector' );

$wgHooks['BeforePageDisplay'][] = static function ( OutputPage $out, Skin $skin ): void {
	$out->addStyle( '/wiki/resources/assets/woc-mediawiki.css' );
	$out->addStyle( '/wiki/resources/assets/encyclopedia/hover_tooltip.css' );
	$out->addHeadItem( 'woc-hover-cards', '<script type="module" src="/wiki/resources/assets/encyclopedia/mediawiki_hover.js"></script>' );
};

// Page art is limited to packaged game images. Wiki editors cannot supply a host or arbitrary markup.
$wgHooks['ParserFirstCallInit'][] = static function ( $parser ) use ( $wgScriptPath ) {
    $parser->setHook( 'woc-art', static function ( $input, $args ) use ( $wgScriptPath ) {
        $path = $args['path'] ?? '';
        if ( !preg_match( '~^/(?:ui|map_bg|textures/loading)/[A-Za-z0-9_/-]+\.(?:webp|png|jpg)$~D', $path ) ) {
            return '';
        }
        $class = ( $args['size'] ?? '' ) === 'icon' ? 'woc-inline-art' : 'woc-page-art';
        return '<img class="' . $class . '" alt="" src="' . htmlspecialchars( $wgScriptPath . '/resources/assets/game' . $path, ENT_QUOTES ) . '">';
    } );
    // Formulas: frac(top, bottom) is a stacked fraction and pow(base, exponent) a
    // superscript, matching mediawiki/reader/math.js. All other text is escaped.
    $parser->setHook( 'woc-math', static function ( $input, $args ) {
        // Walk whole UTF-8 characters so ×, ÷ and − are never split mid-byte.
        $chars = preg_split( '//u', (string)$input, -1, PREG_SPLIT_NO_EMPTY ) ?: [];
        $i = 0;
        $sequence = static function ( array $stops ) use ( &$sequence, &$i, $chars ) {
            $html = '';
            $text = '';
            $depth = 0;
            $len = count( $chars );
            while ( $i < $len ) {
                if ( preg_match( '/^(frac|pow)\(/', implode( '', array_slice( $chars, $i, 5 ) ), $m ) ) {
                    $i += strlen( $m[0] );
                    $a = $sequence( [ ',' ] );
                    $i++;
                    while ( $i < $len && $chars[$i] === ' ' ) {
                        $i++;
                    }
                    $b = $sequence( [ ')' ] );
                    $i++;
                    if ( $m[1] === 'frac' ) {
                        $plain = '(' . $a[1] . ') ÷ (' . $b[1] . ')';
                        $html .= '<span class="woc-frac"><span class="woc-frac-top" aria-hidden="true">' . $a[0]
                            . '</span><span class="woc-frac-bottom" aria-hidden="true">' . $b[0]
                            . '</span><span class="woc-math-text">' . htmlspecialchars( $plain, ENT_QUOTES ) . '</span></span>';
                        $text .= $plain;
                    } else {
                        $html .= $a[0] . '<sup>' . $b[0] . '</sup>';
                        $text .= $a[1] . '^(' . $b[1] . ')';
                    }
                    continue;
                }
                $ch = $chars[$i];
                if ( $depth === 0 && in_array( $ch, $stops, true ) ) {
                    break;
                }
                if ( $ch === '(' ) {
                    $depth++;
                } elseif ( $ch === ')' ) {
                    $depth--;
                }
                $html .= htmlspecialchars( $ch, ENT_QUOTES );
                $text .= $ch;
                $i++;
            }
            return [ $html, $text ];
        };
        $formula = '<span class="woc-math">' . $sequence( [] )[0] . '</span>';
        // A power bonus shows its short label; the working appears on hover or focus.
        $label = $args['label'] ?? '';
        if ( $label === '' ) {
            return $formula;
        }
        return '<span class="woc-scale" tabindex="0">(' . htmlspecialchars( $label, ENT_QUOTES )
            . ')<span class="woc-scale-tip" role="tooltip">' . $formula
            . ( ( $args['note'] ?? '' ) !== '' ? '<small>' . htmlspecialchars( $args['note'], ENT_QUOTES ) . '</small>' : '' )
            . '</span></span>';
    } );
};
