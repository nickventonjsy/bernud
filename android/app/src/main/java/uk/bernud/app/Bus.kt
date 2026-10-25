package uk.bernud.app

// Tiny in-process link between the notification / quick-settings tile and the open Bernard screen.
object Bus {
    var talk: (() -> Unit)? = null
    var finish: (() -> Unit)? = null
}
