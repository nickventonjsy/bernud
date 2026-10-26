package uk.bernud.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

// "Ask Bernard" tile: one big button that opens Bernard already listening.
class AskTile : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val launch = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName(WearActivity::class.java.name)
                    .addKeyToExtraMapping(WearActivity.EXTRA_TALK, ActionBuilders.AndroidBooleanExtra.Builder().setValue(true).build())
                    .build()
            ).build()
        val clickable = ModifiersBuilders.Clickable.Builder().setId("ask").setOnClick(launch).build()

        val label = LayoutElementBuilders.Text.Builder()
            .setText("Ask Bernard")
            .setMaxLines(2)
            .setFontStyle(LayoutElementBuilders.FontStyle.Builder().setSize(sp(15f)).setColor(argb(0xFFFFFFFF.toInt())).setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD).build())
            .build()
        val button = LayoutElementBuilders.Box.Builder()
            .setWidth(dp(120f)).setHeight(dp(120f))
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(clickable)
                    .setBackground(ModifiersBuilders.Background.Builder().setColor(argb(0xFFC8102E.toInt())).setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(60f)).build()).build())
                    .build()
            )
            .addContent(label)
            .build()
        val root = LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand()).addContent(button).build()

        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion("1")
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(root))
            .build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion("1").build())
}
