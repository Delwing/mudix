-- quick-links.lua — echo a few clickable links to the main output.
-- Each link runs a command when clicked; the third arg is the hover tooltip.

echo("\n")

-- Simple text links: echoLink(text, command, tooltip)
echoLink("[ Look ]", "look", "Look at your surroundings")
echo("  ")
echoLink("[ Inventory ]", "inventory", "Check your inventory")
echo("  ")
echoLink("[ Score ]", "score", "Show your character sheet")
echo("\n")

-- Colored links work too — cechoLink uses Mudlet color tags.
cechoLink("<green>[ Go North ]", "north", "Walk north", true)
echo("  ")
cechoLink("<red>[ Flee ]", "flee", "Run away!", true)
echo("\n")

-- A popup link: click to get a menu of several commands.
echoPopup(
  "[ Cardinal directions ]",
  { "north", "south", "east", "west" },
  { "Go north", "Go south", "Go east", "Go west" }
)
echo("\n")
