// Overlay visibility.
//
// Whether the character is shown is the configuration's `visible`. Hiding only
// hides the character. The capture indicator is computed from the permissions
// alone, so it cannot be hidden by anything here: while any capture runs,
// `indicator.visible` is true whether the character is shown or not.

export const isVisible = config => config.visible === true

export const indicatorFor = permissions => {
  const kinds = permissions.activeKinds()
  return { visible: kinds.length > 0, kinds }
}
