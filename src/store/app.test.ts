import { describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/types'

import { isAuthText, pickRegion } from './app'

const profile = (p: Partial<Profile>): Profile => ({
  name: 'p',
  accountId: null,
  region: 'us-east-1',
  regions: ['us-east-1', 'eu-west-1'],
  authKind: 'sso',
  isProd: false,
  readOnly: false,
  ...p,
})

describe('pickRegion', () => {
  it('prefers the last region when the profile has it', () => {
    expect(pickRegion(profile({}), 'eu-west-1')).toBe('eu-west-1')
    expect(pickRegion(profile({}), 'ap-south-1')).toBe('us-east-1')
    expect(pickRegion(profile({ region: 'sa-east-1' }), null)).toBe('us-east-1')
  })
})

describe('isAuthText', () => {
  it('detects expired sessions in poller errors', () => {
    expect(isAuthText('The SSO session for demo-prod has expired.')).toBe(true)
    expect(isAuthText('Rate exceeded')).toBe(false)
  })
})
