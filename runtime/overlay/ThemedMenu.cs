// Menus in the theme's colours (a black menu with the accent on the hovered row)
// instead of the system's white one.

using System.Drawing;
using System.Windows.Forms;

namespace MiniBot
{
    public class ThemedMenuColors : ProfessionalColorTable
    {
        readonly Palette p;
        public ThemedMenuColors(Palette palette) { p = palette; UseSystemColors = false; }

        public override Color ToolStripDropDownBackground { get { return p.Field; } }
        public override Color ImageMarginGradientBegin { get { return p.Field; } }
        public override Color ImageMarginGradientMiddle { get { return p.Field; } }
        public override Color ImageMarginGradientEnd { get { return p.Field; } }
        public override Color MenuBorder { get { return p.Subtle; } }
        public override Color MenuItemBorder { get { return p.Accent; } }
        public override Color MenuItemSelected { get { return p.UserMessage; } }
        public override Color MenuItemSelectedGradientBegin { get { return p.UserMessage; } }
        public override Color MenuItemSelectedGradientEnd { get { return p.UserMessage; } }
        public override Color MenuItemPressedGradientBegin { get { return p.UserMessage; } }
        public override Color MenuItemPressedGradientEnd { get { return p.UserMessage; } }
        public override Color SeparatorDark { get { return p.Subtle; } }
        public override Color SeparatorLight { get { return p.Subtle; } }
        public override Color CheckBackground { get { return p.Accent; } }
        public override Color CheckSelectedBackground { get { return p.Accent; } }
        public override Color CheckPressedBackground { get { return p.Accent; } }
    }

    public class ThemedMenuRenderer : ToolStripProfessionalRenderer
    {
        readonly Palette p;
        public ThemedMenuRenderer(Palette palette) : base(new ThemedMenuColors(palette)) { p = palette; RoundedEdges = false; }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Enabled ? p.Fg : p.Subtle;
            base.OnRenderItemText(e);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            e.ArrowColor = p.Muted;
            base.OnRenderArrow(e);
        }
    }
}
