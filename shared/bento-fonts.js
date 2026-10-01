// Message fonts for the bento designer (codes match design_options group 'font', phase 35).
// family/weight are the Google Fonts loaded in index.html; stroke thickens thin fonts so they still read
// like piped icing (lower for detailed fonts such as blackletter so the strokes don't blur together);
// group is the filter chip in the font sheet.
window.LexcBentoFonts = Object.freeze({
  rounded: { group: 'Classic', family: 'Nunito', weight: 800, stroke: 1, kind: 'Rounded' },
  playfair: { group: 'Classic', family: 'Playfair Display', weight: 700, stroke: 0.75, kind: 'Elegant serif' },
  great_vibes: { group: 'Script', family: 'Great Vibes', weight: 400, stroke: 1.15, kind: 'Script' },
  dancing: { group: 'Script', family: 'Dancing Script', weight: 700, stroke: 0.9, kind: 'Script' },
  pacifico: { group: 'Script', family: 'Pacifico', weight: 400, stroke: 0.8, kind: 'Retro script' },
  lobster: { group: 'Script', family: 'Lobster', weight: 400, stroke: 0.8, kind: 'Bold script' },
  satisfy: { group: 'Script', family: 'Satisfy', weight: 400, stroke: 1.05, kind: 'Script' },
  parisienne: { group: 'Script', family: 'Parisienne', weight: 400, stroke: 1.1, kind: 'Script' },
  montserrat: { group: 'Modern', family: 'Montserrat', weight: 800, stroke: 0.75, kind: 'Modern' },
  poppins: { group: 'Modern', family: 'Poppins', weight: 700, stroke: 0.75, kind: 'Modern' },
  fredoka: { group: 'Fun', family: 'Fredoka', weight: 600, stroke: 0.85, kind: 'Bubbly' },
  baloo: { group: 'Fun', family: 'Baloo 2', weight: 800, stroke: 0.85, kind: 'Bubbly' },
  caveat: { group: 'Fun', family: 'Caveat', weight: 700, stroke: 0.95, kind: 'Handwritten' },
  cinzel: { group: 'Classic', family: 'Cinzel', weight: 700, stroke: 0.45, kind: 'Classic capitals' },
  gothic: { group: 'Gothic', family: 'Grenze Gotisch', weight: 700, stroke: 0.25, kind: 'Gothic' },
  blackletter: { group: 'Gothic', family: 'UnifrakturMaguntia', weight: 400, stroke: 0.2, kind: 'Old English gothic' }
});
