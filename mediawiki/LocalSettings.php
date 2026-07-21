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
};
