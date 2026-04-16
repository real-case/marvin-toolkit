# OWASP ASVS 4.0 — Quick Reference Checklist

Reference for the `mn.sec.compliance` skill. Organized by chapter with key requirements per ASVS level.

**Legend:** L1 = Level 1, L2 = Level 2, L3 = Level 3. Higher levels include all lower-level requirements.

---

## V1 — Architecture, Design, and Threat Modeling

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V1.1.1 | Secure SDLC process in place | | ✓ | ✓ |
| V1.1.2 | Threat modeling for design changes | | ✓ | ✓ |
| V1.1.3 | All user stories include security constraints | | ✓ | ✓ |
| V1.2.1 | Unique identities for all accounts and services | | ✓ | ✓ |
| V1.2.3 | Authentication verifier is separate from application logic | | ✓ | ✓ |
| V1.4.1 | Trusted enforcement points (server-side) for access control | ✓ | ✓ | ✓ |
| V1.4.4 | Single well-vetted access control mechanism | ✓ | ✓ | ✓ |
| V1.5.1 | Input validation at a trusted layer | ✓ | ✓ | ✓ |
| V1.5.3 | Output encoding near or at the interpreter | ✓ | ✓ | ✓ |
| V1.6.1 | Cryptographic key management exists | | ✓ | ✓ |
| V1.8.1 | Sensitive data identified and classified | | ✓ | ✓ |
| V1.8.2 | Protection levels applied per classification | | ✓ | ✓ |
| V1.11.1 | Application components follow least privilege | ✓ | ✓ | ✓ |
| V1.14.1 | Segregation of different trust levels | | ✓ | ✓ |

## V2 — Authentication

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V2.1.1 | User-set password minimum 12 characters | ✓ | ✓ | ✓ |
| V2.1.2 | Passwords of 64+ characters permitted | ✓ | ✓ | ✓ |
| V2.1.3 | No password truncation | ✓ | ✓ | ✓ |
| V2.1.4 | Any Unicode characters allowed in passwords | ✓ | ✓ | ✓ |
| V2.1.5 | Users can change their password | ✓ | ✓ | ✓ |
| V2.1.6 | Password change requires current password | ✓ | ✓ | ✓ |
| V2.1.7 | Passwords checked against breached password sets | ✓ | ✓ | ✓ |
| V2.1.9 | No password composition rules beyond minimum length | ✓ | ✓ | ✓ |
| V2.1.10 | No periodic credential rotation requirements | ✓ | ✓ | ✓ |
| V2.1.12 | User can view their masked password during entry | ✓ | ✓ | ✓ |
| V2.2.1 | Anti-automation controls for credential attacks | ✓ | ✓ | ✓ |
| V2.2.2 | Weak authenticator use (SMS, email) only as secondary | | ✓ | ✓ |
| V2.2.3 | Secure notification after auth changes | ✓ | ✓ | ✓ |
| V2.3.1 | System-generated initial passwords are secure and random | ✓ | ✓ | ✓ |
| V2.4.1 | Passwords stored using approved hashing (bcrypt/scrypt/argon2) | ✓ | ✓ | ✓ |
| V2.5.1 | System-generated temporary credentials are securely random | ✓ | ✓ | ✓ |
| V2.5.6 | Forgot password does not reveal account existence | ✓ | ✓ | ✓ |
| V2.7.1 | OTP/MFA tokens have limited validity | ✓ | ✓ | ✓ |
| V2.8.1 | Time-based OTP has defined lifetime | | ✓ | ✓ |
| V2.9.1 | Keys are stored in server-side TPM or software vault | | | ✓ |
| V2.10.1 | No static API keys or passwords in integrations | | ✓ | ✓ |
| V2.10.2 | API keys provide minimum necessary access | | ✓ | ✓ |

## V3 — Session Management

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V3.1.1 | URLs do not contain session tokens | ✓ | ✓ | ✓ |
| V3.2.1 | Session tokens are generated with >= 64 bits of entropy | ✓ | ✓ | ✓ |
| V3.2.2 | Session tokens stored in secure storage, not local storage | ✓ | ✓ | ✓ |
| V3.2.3 | Session tokens use cookie with HttpOnly, Secure, SameSite | ✓ | ✓ | ✓ |
| V3.3.1 | Logout invalidates session token server-side | ✓ | ✓ | ✓ |
| V3.3.2 | Sessions expire after configurable idle timeout | ✓ | ✓ | ✓ |
| V3.3.4 | Admin can terminate active sessions for a user | | ✓ | ✓ |
| V3.4.1 | Cookie-based tokens have Secure attribute | ✓ | ✓ | ✓ |
| V3.4.2 | Cookie-based tokens have HttpOnly attribute | ✓ | ✓ | ✓ |
| V3.4.3 | Cookie-based tokens have SameSite attribute | ✓ | ✓ | ✓ |
| V3.5.2 | Application uses signed JWTs (not unsigned) | ✓ | ✓ | ✓ |
| V3.5.3 | JWTs validated for expiration, issuer, audience | ✓ | ✓ | ✓ |
| V3.7.1 | Application protects against session fixation | ✓ | ✓ | ✓ |

## V4 — Access Control

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V4.1.1 | Application enforces access control at server/API side | ✓ | ✓ | ✓ |
| V4.1.2 | All user and data attributes used in access control cannot be manipulated by end users | ✓ | ✓ | ✓ |
| V4.1.3 | Principle of least privilege: access only to what's needed | ✓ | ✓ | ✓ |
| V4.2.1 | Sensitive resources are protected against IDOR | ✓ | ✓ | ✓ |
| V4.2.2 | Application or framework enforces anti-CSRF | ✓ | ✓ | ✓ |
| V4.3.1 | Admin interfaces use MFA or other strong authentication | ✓ | ✓ | ✓ |
| V4.3.2 | Directory listing is disabled | ✓ | ✓ | ✓ |
| V4.3.3 | Application doesn't allow discovery of API keys or resources | ✓ | ✓ | ✓ |

## V5 — Validation, Sanitization, and Encoding

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V5.1.1 | HTTP parameter pollution defenses in place | ✓ | ✓ | ✓ |
| V5.1.3 | All input validated using positive validation (allowlists) | ✓ | ✓ | ✓ |
| V5.1.4 | Structured data strongly typed and validated | ✓ | ✓ | ✓ |
| V5.2.1 | Anti-automation controls on all inputs | ✓ | ✓ | ✓ |
| V5.2.4 | Structured data validated against schema (JSON schema, XML DTD) | ✓ | ✓ | ✓ |
| V5.2.6 | Unstructured data sanitized with commonly used safety measures | ✓ | ✓ | ✓ |
| V5.3.1 | Output encoding relevant to the interpreter | ✓ | ✓ | ✓ |
| V5.3.3 | Context-aware output escaping used to protect against XSS | ✓ | ✓ | ✓ |
| V5.3.4 | Data selection or database queries use parameterized queries | ✓ | ✓ | ✓ |
| V5.3.7 | Application protects against LDAP injection | ✓ | ✓ | ✓ |
| V5.3.8 | Application protects against OS command injection | ✓ | ✓ | ✓ |
| V5.3.10 | Application protects against XPath or XML injection | ✓ | ✓ | ✓ |
| V5.5.1 | Serialized objects use integrity checks or encryption | ✓ | ✓ | ✓ |
| V5.5.3 | Deserialization of untrusted data is avoided | ✓ | ✓ | ✓ |

## V6 — Stored Cryptography

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V6.1.1 | Regulated private data encrypted at rest | | ✓ | ✓ |
| V6.1.2 | Regulated health data encrypted at rest | | ✓ | ✓ |
| V6.2.1 | All cryptographic modules fail securely | ✓ | ✓ | ✓ |
| V6.2.2 | Industry-proven cryptographic algorithms used | ✓ | ✓ | ✓ |
| V6.2.5 | Known-insecure algorithms (MD5, SHA1, DES) not used | ✓ | ✓ | ✓ |
| V6.2.6 | Nonces, IVs, etc. not reused with a given key | ✓ | ✓ | ✓ |
| V6.3.1 | All random values from CSPRNG | ✓ | ✓ | ✓ |
| V6.4.1 | Key management solution in place | | ✓ | ✓ |
| V6.4.2 | Keys have access controls and auditing | | ✓ | ✓ |

## V7 — Error Handling and Logging

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V7.1.1 | Application does not log credentials or payment details | ✓ | ✓ | ✓ |
| V7.1.2 | Application does not log sensitive data as defined under privacy regulations | ✓ | ✓ | ✓ |
| V7.1.3 | Application logs security-relevant events (auth, access control) | | ✓ | ✓ |
| V7.1.4 | Each log event includes context for investigation | | ✓ | ✓ |
| V7.2.1 | All authentication decisions are logged | | ✓ | ✓ |
| V7.2.2 | All access control decisions are logged | | ✓ | ✓ |
| V7.3.1 | No sensitive information in error messages | ✓ | ✓ | ✓ |
| V7.4.1 | Generic error message used for unexpected errors | ✓ | ✓ | ✓ |
| V7.4.2 | Exception handling used across the codebase | | ✓ | ✓ |
| V7.4.3 | "Last resort" error handler catches all exceptions | | ✓ | ✓ |

## V8 — Data Protection

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V8.1.1 | Application protects sensitive data from caching in server components | ✓ | ✓ | ✓ |
| V8.1.2 | All cached/temporary sensitive data is purged after use | ✓ | ✓ | ✓ |
| V8.2.1 | Application sets sufficient anti-caching headers | ✓ | ✓ | ✓ |
| V8.2.2 | Data in browser storage doesn't contain sensitive data | ✓ | ✓ | ✓ |
| V8.3.1 | Sensitive data sent in the HTTP message body or headers | ✓ | ✓ | ✓ |
| V8.3.4 | Sensitive data does not appear in GET query parameters | ✓ | ✓ | ✓ |

## V9 — Communication

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V9.1.1 | TLS used for all client-server connections | ✓ | ✓ | ✓ |
| V9.1.2 | TLS 1.2 or higher used; TLS 1.0/1.1 disabled | ✓ | ✓ | ✓ |
| V9.1.3 | Only strong cipher suites enabled | ✓ | ✓ | ✓ |
| V9.2.1 | Connections to/from server use trusted TLS certificates | | ✓ | ✓ |
| V9.2.2 | Encrypted communications (TLS) used for all inbound and outbound connections | | ✓ | ✓ |

## V10 — Malicious Code

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V10.1.1 | Code analysis tool detects potentially malicious code | | | ✓ |
| V10.2.1 | Application source code and libraries do not contain time bombs | | ✓ | ✓ |
| V10.2.2 | Application does not phone home to unintended destinations | | ✓ | ✓ |
| V10.3.1 | Application has update mechanism with integrity checks | ✓ | ✓ | ✓ |
| V10.3.2 | Application employs integrity protections (code signing) | | | ✓ |

## V11 — Business Logic

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V11.1.1 | Application processes business logic in deterministic order | ✓ | ✓ | ✓ |
| V11.1.2 | Application processes business logic with all steps validated | ✓ | ✓ | ✓ |
| V11.1.3 | Application validates business logic limits and constraints | ✓ | ✓ | ✓ |
| V11.1.5 | Application has anti-automation controls for business-sensitive transactions | ✓ | ✓ | ✓ |
| V11.1.6 | Application detects and alerts on unusual activity | | ✓ | ✓ |

## V12 — Files and Resources

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V12.1.1 | Application does not accept large files that could fill storage | ✓ | ✓ | ✓ |
| V12.1.2 | Compressed files checked for zip bombs | | ✓ | ✓ |
| V12.3.1 | User-submitted filenames validated; path traversal prevented | ✓ | ✓ | ✓ |
| V12.3.2 | User-submitted files validated for expected properties | ✓ | ✓ | ✓ |
| V12.4.1 | Files from untrusted sources stored outside web root | ✓ | ✓ | ✓ |
| V12.4.2 | Files from untrusted sources served by a separate domain | ✓ | ✓ | ✓ |
| V12.5.1 | Application does not submit to unintended resource types | ✓ | ✓ | ✓ |
| V12.6.1 | Web server configured to only serve expected file types | ✓ | ✓ | ✓ |

## V13 — API and Web Service

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V13.1.1 | All application components use same encoding and parsers | ✓ | ✓ | ✓ |
| V13.1.3 | API URLs do not expose sensitive information | ✓ | ✓ | ✓ |
| V13.2.1 | Enabled RESTful HTTP methods are a valid choice for the user or action | ✓ | ✓ | ✓ |
| V13.2.2 | JSON schema validation is in place before accepting input | ✓ | ✓ | ✓ |
| V13.2.3 | RESTful services utilize anti-CSRF protections | ✓ | ✓ | ✓ |
| V13.2.5 | REST services explicitly check the Content-Type | | ✓ | ✓ |
| V13.3.1 | GraphQL or data layer queries should use allow lists | | ✓ | ✓ |
| V13.4.1 | Query parameterization protects against injection | ✓ | ✓ | ✓ |

## V14 — Configuration

| ID | Requirement | L1 | L2 | L3 |
|----|------------|:--:|:--:|:--:|
| V14.1.1 | Application build and deployment processes performed securely | | ✓ | ✓ |
| V14.1.5 | Server config hardened per server vendor recommendations | | ✓ | ✓ |
| V14.2.1 | All components are up to date | ✓ | ✓ | ✓ |
| V14.2.2 | All unnecessary features, documentation, samples removed | ✓ | ✓ | ✓ |
| V14.2.3 | Application assets (JS, CSS) not hosted on CDNs without SRI | ✓ | ✓ | ✓ |
| V14.3.1 | Web or application server not configured with debug flags | ✓ | ✓ | ✓ |
| V14.3.2 | HTTP response headers do not reveal system information | ✓ | ✓ | ✓ |
| V14.3.3 | CSP header is in place and appropriate | ✓ | ✓ | ✓ |
| V14.4.1 | Every HTTP response contains Content-Type header | ✓ | ✓ | ✓ |
| V14.4.3 | Content-Security-Policy response header is in place | ✓ | ✓ | ✓ |
| V14.4.4 | All responses contain X-Content-Type-Options: nosniff | ✓ | ✓ | ✓ |
| V14.4.5 | Strict-Transport-Security header is in place | ✓ | ✓ | ✓ |
| V14.4.7 | Suitable X-Frame-Options or Content-Security-Policy in place | ✓ | ✓ | ✓ |
| V14.5.3 | Application has CORS policy with appropriate origins | ✓ | ✓ | ✓ |

---

This is a condensed reference. The full ASVS 4.0 standard contains 286 requirements. Refer to the [official OWASP ASVS documentation](https://owasp.org/www-project-application-security-verification-standard/) for the complete specification.
