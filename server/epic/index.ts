// Public surface of the Epic link + achievement-mirror domain, for the
// registry ONLY (it spreads `routes`). Everything else imports the concrete
// module (./epic/config for the enabled flag, ./epic/mirror for the
// observer): this barrel drags routes.ts, whose middleware construction
// touches db-boundary exports at load, so pulling it into game.ts's graph
// would break every test that partial-mocks the db module.

export { routes } from './routes';
