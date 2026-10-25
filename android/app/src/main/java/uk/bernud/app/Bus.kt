package uk.bernud.app

// Tiny in-process link between the notification / quick-settings tile and the open Bernard screen.
object Bus {
    var talk: (() -> Unit)? = null   // toggle (notification button, tile)
    var wake: (() -> Unit)? = null   // wake word heard: start talking
    var finish: (() -> Unit)? = null
}
