import { useState } from "@lynx-js/react";
import {
  Box,
  Text,
  Heading,
  Card,
  Button,
  Badge,
  Avatar,
  Grid,
  Tabs
} from "../../ui/index.js";
import { DynamicPageRenderer, type DynamicPageSchema } from "../renderer.jsx";
import { FeedList } from "../../views/FeedList.jsx";
import type { PostItem } from "../../views/types.js";

export interface PersonalHomePageProps {
  handle?: string | undefined;
  displayHandle?: string | undefined;
  did?: string | undefined;
  avatarUrl?: string | undefined;
  feedPosts: PostItem[];
  timelinePosts?: PostItem[] | undefined;
  unreadDmCount?: number | undefined;
  homeLayout?: string | undefined;
  onNavigate: (route: string) => void;
  compactViewport?: boolean | undefined;
}

/**
 * PersonalHomePage — The hyper-personalized home experience for authenticated users.
 * Offers personal dashboard widgets, Studio authoring shortcuts, followed feed, and district portals.
 */
export function PersonalHomePage({
  displayHandle = "@traveler",
  did,
  avatarUrl,
  feedPosts,
  timelinePosts = [],
  unreadDmCount = 0,
  homeLayout,
  onNavigate,
  compactViewport = false
}: PersonalHomePageProps) {
  const [activeTab, setActiveTab] = useState<string>("followed");
  const [showStandardWidgets, setShowStandardWidgets] = useState(false);

  let customSchema: DynamicPageSchema | null = null;
  if (homeLayout) {
    try {
      const parsed = typeof homeLayout === "string" ? (JSON.parse(homeLayout) as Record<string, unknown>) : (homeLayout as unknown as Record<string, unknown>);
      if (parsed && (("type" in parsed && typeof parsed.type === "string") || ("root" in parsed && typeof parsed.root === "object"))) {
        customSchema = parsed as unknown as DynamicPageSchema;
      }
    } catch {
      customSchema = null;
    }
  }
  return (
    <Box direction="column" gap="large" pad="large" width="100%">
      {/* Personal Identity Header Card */}
      <Card background="surface" border={{ color: "brand" }} elevation="glow" pad="large" gap="medium">
        <Box direction="row" justify="between" align="center" wrap={true} gap="medium">
          <Box direction="row" align="center" gap="medium">
            <Avatar src={avatarUrl} name={displayHandle} size="large" status="online" />
            <Box direction="column" gap="xxsmall">
              <Box direction="row" align="center" gap="small">
                <Heading level={2} color="text" mono>
                  {displayHandle}
                </Heading>
                <Badge value="AUTHENTICATED" variant="ok" />
              </Box>
              <Text size="small" color="brand" mono>
                {did ?? "Decentralized Identity Connected"}
              </Text>
            </Box>
          </Box>

          <Box direction="row" gap="small" wrap={true}>
            {customSchema && (
              <Button
                label={showStandardWidgets ? "SHOW CUSTOM HOME" : "SHOW DASHBOARD"}
                variant="subtle"
                size="small"
                onClick={() => setShowStandardWidgets(!showStandardWidgets)}
                bindtap={() => setShowStandardWidgets(!showStandardWidgets)}
              />
            )}
            <Button
              label="STUDIO // EDIT HOME"
              variant="primary"
              size="small"
              onClick={() => onNavigate("/studio")}
              bindtap={() => onNavigate("/studio")}
            />
            <Button
              label="WORLD VIEW"
              variant="secondary"
              size="small"
              onClick={() => onNavigate("/town")}
              bindtap={() => onNavigate("/town")}
            />
          </Box>
        </Box>
      </Card>

      {/* If user has an authored custom layout, render it here */}
      {customSchema && !showStandardWidgets ? (
        <Box direction="column" gap="large" width="100%">
          <Card background="surfaceSubtle" border={{ color: "brand" }} pad={{ horizontal: "large", vertical: "small" }}>
            <Box direction="row" justify="between" align="center">
              <Text size="small" color="brand" mono>
                ✦ AUTHORED CUSTOM HOME ACTIVE (via Studio & WebMCP)
              </Text>
              <Button
                label="EDIT IN STUDIO"
                variant="ghost"
                size="small"
                onClick={() => onNavigate("/studio")}
                bindtap={() => onNavigate("/studio")}
              />
            </Box>
          </Card>

          <DynamicPageRenderer schema={customSchema} onNavigate={onNavigate} />
        </Box>
      ) : (
        <>

      {/* Quick Action Matrix */}
      <Grid columns={compactViewport ? 2 : 4} gap="medium">
        <Card
          background="surfaceSubtle"
          border={{ color: "borderSubtle", size: "1px" }}
          pad="medium"
          gap="xsmall"
          style="cursor:pointer;"
          bindtap={() => onNavigate("/studio")}
          onClick={() => onNavigate("/studio")}
        >
          <Text size="small" weight="bold" color="brand" mono>
            ✦ STUDIO
          </Text>
          <Text size="xsmall" color="textMuted">
            Author index.tsx & publish your site
          </Text>
        </Card>

        <Card
          background="surfaceSubtle"
          border={{ color: "borderSubtle", size: "1px" }}
          pad="medium"
          gap="xsmall"
          style="cursor:pointer;"
          bindtap={() => onNavigate("/messages")}
          onClick={() => onNavigate("/messages")}
        >
          <Box direction="row" justify="between" align="center">
            <Text size="small" weight="bold" color="accentPhosphor" mono>
              ✉ MESSAGES
            </Text>
            {unreadDmCount > 0 && <Badge value={unreadDmCount} variant="brand" />}
          </Box>
          <Text size="xsmall" color="textMuted">
            Encrypted direct channels & agent chats
          </Text>
        </Card>

        <Card
          background="surfaceSubtle"
          border={{ color: "borderSubtle", size: "1px" }}
          pad="medium"
          gap="xsmall"
          style="cursor:pointer;"
          bindtap={() => onNavigate("/town")}
          onClick={() => onNavigate("/town")}
        >
          <Text size="small" weight="bold" color="accentMagenta" mono>
            ◈ TOWN SQUARE
          </Text>
          <Text size="xsmall" color="textMuted">
            Public forum & broadcast tower
          </Text>
        </Card>

        <Card
          background="surfaceSubtle"
          border={{ color: "borderSubtle", size: "1px" }}
          pad="medium"
          gap="xsmall"
          style="cursor:pointer;"
          bindtap={() => onNavigate("/settings")}
          onClick={() => onNavigate("/settings")}
        >
          <Text size="small" weight="bold" color="text" mono>
            ⚙ SETTINGS
          </Text>
          <Text size="xsmall" color="textMuted">
            Home mode, vanity domain, DM agents
          </Text>
        </Card>
      </Grid>

      {/* Stream Selector: Followed Feed vs Town Square */}
      <Card background="surface" pad="large" gap="medium">
        <Tabs
          activeId={activeTab}
          onSelect={(id) => setActiveTab(id)}
          tabs={[
            { id: "followed", label: "FOLLOWED TIMELINE", badge: timelinePosts.length },
            { id: "town", label: "TOWN SQUARE DISPATCHES", badge: feedPosts.length }
          ]}
        >
          <Box direction="column" pad={{ top: "medium" }}>
            {activeTab === "followed" ? (
              timelinePosts.length > 0 ? (
                <FeedList posts={timelinePosts} navigate={onNavigate} />
              ) : (
                <Box align="center" justify="center" pad="xlarge" gap="medium">
                  <Text size="medium" color="textMuted" mono>
                    No dispatches from followed actors yet.
                  </Text>
                  <Button
                    label="EXPLORE TOWN SQUARE"
                    variant="secondary"
                    onClick={() => setActiveTab("town")}
                    bindtap={() => setActiveTab("town")}
                  />
                </Box>
              )
            ) : (
              <FeedList posts={feedPosts} navigate={onNavigate} />
            )}
          </Box>
        </Tabs>
      </Card>
      </>
      )}
    </Box>
  );
}
