# Changelog

## [0.2.0](https://github.com/jr200-labs/nats-otlp-exporter/compare/v0.1.2...v0.2.0) (2026-04-24)


### Features

* add syncpack for semver range consistency ([e0f4c6b](https://github.com/jr200-labs/nats-otlp-exporter/commit/e0f4c6b0dcfe3f0fe11c052a89a1c86a87d1b4cd))
* add syncpack for semver range consistency ([f8558e3](https://github.com/jr200-labs/nats-otlp-exporter/commit/f8558e3c7d0996eb936bdb5a0da132986ac776da))
* add verify-lockfile pre-commit check ([ea81010](https://github.com/jr200-labs/nats-otlp-exporter/commit/ea810102ef4bd7957ec10cd8337346550295869f))
* add verify-lockfile pre-commit check ([45a664a](https://github.com/jr200-labs/nats-otlp-exporter/commit/45a664a0999765ecd2f65a05e25646dc9ce2ff54))
* adopt release-please + migrate syncpack to shared base (JRL-30) ([#12](https://github.com/jr200-labs/nats-otlp-exporter/issues/12)) ([dda3e5b](https://github.com/jr200-labs/nats-otlp-exporter/commit/dda3e5b3cf69310ffedad7b8dd9961525881e433))
* shared lint config ([ef3b6cb](https://github.com/jr200-labs/nats-otlp-exporter/commit/ef3b6cbf757720a54a533731027d54ec5648d492))
* wire up shared eslint config from github-action-templates ([4baf1dd](https://github.com/jr200-labs/nats-otlp-exporter/commit/4baf1ddfb6d462b5aa84ad23a98d84f6e76f6feb))


### Bug Fixes

* add vite ^6.0.0 as direct dep — vitest 4.x requires vite 6+ ([e2cd43d](https://github.com/jr200-labs/nats-otlp-exporter/commit/e2cd43dd3c164d0ea240baae190f705ffcff5569))
* **ci:** add security-events:read permission for renovate vulnerability alerts ([7cd91ce](https://github.com/jr200-labs/nats-otlp-exporter/commit/7cd91ce84033d728f3acd3b3b9ab03cb99e63022))
* **ci:** remove duplicate runner line from workflow_dispatch inputs ([c526b77](https://github.com/jr200-labs/nats-otlp-exporter/commit/c526b7719cbae0c68f294ebfbb8d30a57a040fa9))
* **ci:** use arc-linux runner label for renovate ([19d5361](https://github.com/jr200-labs/nats-otlp-exporter/commit/19d536191d2a33680a85ac32f58985ab69f97618))
* **ci:** use arc-linux-jr200-labs runner label ([3a004c6](https://github.com/jr200-labs/nats-otlp-exporter/commit/3a004c617a50dc316548b9ca7fbfbf3479cbbd71))
* renovate workflow ref [@main](https://github.com/main) → [@master](https://github.com/master) ([4f58ddc](https://github.com/jr200-labs/nats-otlp-exporter/commit/4f58ddcef11f4a1ee24c9fc0c3ca48a2662cc897))
* **renovate:** pass INTEGRATION_APP_PRIVATE_KEY explicitly across orgs ([2e6a2e1](https://github.com/jr200-labs/nats-otlp-exporter/commit/2e6a2e10663ee3e307391a26a064489199ce1504))


### Reverts

* remove incorrect security-events permission from renovate caller ([ab746f8](https://github.com/jr200-labs/nats-otlp-exporter/commit/ab746f8f3327d61cb30243e5a27f995442063efa))
