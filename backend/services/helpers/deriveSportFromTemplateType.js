/**
 * Derives sport type from template_type deterministically.
 * Backend is authoritative for sport classification.
 * Clients must not infer or compute sport—only display what backend provides.
 *
 * @param {string|null} templateType - The template_type from contest_instances
 * @returns {string} Sport value: 'nfl', 'golf', 'basketball', 'baseball', or 'unknown'
 */
function deriveSportFromTemplateType(templateType) {
  if (!templateType) return 'unknown'

  if (templateType.startsWith('NFL')) return 'nfl'
  if (templateType.startsWith('PGA')) return 'golf'
  if (templateType.startsWith('NBA')) return 'basketball'
  if (templateType.startsWith('MLB')) return 'baseball'

  return 'unknown'
}

module.exports = deriveSportFromTemplateType
