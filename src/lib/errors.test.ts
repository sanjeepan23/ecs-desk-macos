import { describe, expect, it } from 'vitest'

import { errorText } from './errors'

describe('errorText', () => {
  it('names the profile for auth errors', () => {
    expect(errorText({ kind: 'auth', message: 'x' }, 'demo-prod').title).toBe('Your session for demo-prod has expired.')
  })
  it('explains throttling and keeps AWS messages', () => {
    expect(errorText({ kind: 'throttled', message: 'x' }).title).toBe('AWS is throttling requests.')
    expect(errorText({ kind: 'aws', message: 'AccessDenied' }).description).toBe('AccessDenied')
  })
})
