# Third Party Notices

World of ClaudeCraft project code is licensed under the MIT License in
`LICENSE`. Bundled art asset credits are tracked separately in `CREDITS.md`.

This file records the third-party runtime dependency notices added for the
wallet-linking feature. It is intentionally scoped to those new dependencies;
the complete dependency graph remains pinned in `package-lock.json`.

## Reown AppKit

The wallet-linking client uses Reown AppKit. The installed `@reown/*` packages
listed below declare `SEE LICENSE IN LICENSE.md`; their packaged license file is
the Reown Community License Agreement, release date 25 August 2025:

- `@reown/appkit` 1.8.22
- `@reown/appkit-adapter-solana` 1.8.22
- `@reown/appkit-common` 1.8.22
- `@reown/appkit-controllers` 1.8.22
- `@reown/appkit-pay` 1.8.22
- `@reown/appkit-polyfills` 1.8.22
- `@reown/appkit-scaffold-ui` 1.8.22
- `@reown/appkit-ui` 1.8.22
- `@reown/appkit-utils` 1.8.22
- `@reown/appkit-wallet` 1.8.22

Required notice:

> Portions © 2025 Reown, Inc. All Rights Reserved

License copy:

- `third_party/licenses/reown-community-license.md`

## WalletConnect Community-Licensed Packages

Reown AppKit pulls in the WalletConnect runtime packages below. These installed
packages declare `SEE LICENSE IN LICENSE.md`; their packaged license file is the
WalletConnect Community License Agreement, release date 20 August 2025:

- `@walletconnect/core` 2.23.7
- `@walletconnect/sign-client` 2.23.7
- `@walletconnect/types` 2.23.7
- `@walletconnect/universal-provider` 2.23.7
- `@walletconnect/utils` 2.23.7

Required notice:

> Portions © 2025 Reown, Inc. All Rights Reserved

License copy:

- `third_party/licenses/walletconnect-community-license.md`

## WalletConnect MIT Helper Packages

The WalletConnect runtime also installs the following MIT-licensed helper
packages in the `@walletconnect` scope:

- `@walletconnect/environment` 1.0.1
- `@walletconnect/events` 1.0.1
- `@walletconnect/heartbeat` 1.2.2
- `@walletconnect/jsonrpc-http-connection` 1.0.8
- `@walletconnect/jsonrpc-provider` 1.0.14
- `@walletconnect/jsonrpc-types` 1.0.4
- `@walletconnect/jsonrpc-utils` 1.0.8
- `@walletconnect/jsonrpc-ws-connection` 1.0.16
- `@walletconnect/keyvaluestorage` 1.1.1
- `@walletconnect/logger` 3.0.2
- `@walletconnect/relay-api` 1.0.11
- `@walletconnect/relay-auth` 1.1.0
- `@walletconnect/safe-json` 1.0.2
- `@walletconnect/time` 1.0.2
- `@walletconnect/window-getters` 1.0.1
- `@walletconnect/window-metadata` 1.0.1

License: MIT

Copyright (c) 2022 WalletConnect, Inc.

Copyright (c) 2022 WalletConnect (`@walletconnect/keyvaluestorage`)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## WalletConnect 0BSD Transitive Package

The WalletConnect runtime installs `tslib` 1.14.1 as a nested dependency under
the following `@walletconnect` helper packages:

- `@walletconnect/environment`
- `@walletconnect/events`
- `@walletconnect/jsonrpc-utils`
- `@walletconnect/safe-json`
- `@walletconnect/time`
- `@walletconnect/window-getters`
- `@walletconnect/window-metadata`

License: 0BSD

Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## @noble/curves And @noble/hashes

Packages: `@noble/curves` 1.9.7 and transitive `@noble/hashes` 1.8.0.

License: MIT

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## @solana/web3.js

Package: `@solana/web3.js` 1.98.4.

License: MIT

Copyright (c) 2023 Solana Labs, Inc

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## bs58

Package: `bs58` 6.0.0.

License: MIT

Copyright (c) 2018 cryptocoinjs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## TweetNaCl.js

Package: `tweetnacl` 1.0.3.

License: Unlicense / public domain dedication

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## buffer

Package: `buffer` 6.0.3.

License: MIT

Copyright (c) Feross Aboukhadijeh, and other contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
