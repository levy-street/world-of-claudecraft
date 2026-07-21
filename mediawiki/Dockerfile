FROM mediawiki:1.43

COPY mediawiki/apache-wiki.conf /etc/apache2/conf-enabled/wiki-path.conf
COPY mediawiki/entrypoint.sh /usr/local/bin/woc-mediawiki-entrypoint
COPY mediawiki/LocalSettings.php /opt/woc/LocalSettings.php
COPY mediawiki/seed/pages.xml /opt/woc/seed/pages.xml
COPY mediawiki/theme/Common.css /var/www/html/resources/assets/woc-mediawiki.css
COPY public/loading-screen.jpg /var/www/html/resources/assets/woc-loading-screen.jpg
COPY public/woc_logo_square.webp /var/www/html/resources/assets/woc-logo-square.webp
COPY public/worldofclaudecraft-logo.png /var/www/html/resources/assets/worldofclaudecraft-logo.png

RUN chmod +x /usr/local/bin/woc-mediawiki-entrypoint

ENTRYPOINT ["woc-mediawiki-entrypoint"]
CMD ["apache2-foreground"]
