import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    // Test titles mirror the spec's requirement and scenario names verbatim.
    'test/prefer-lowercase-title': 'off',
  },
})
