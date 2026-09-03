import { Box, Card, Heading, Text, Badge, Button } from "../ui/index.js";

export interface StudioViewProps {
  siteSlug: string;
  hasContent: boolean;
  routeError?: string | undefined;
  navigate?: ((route: string) => void) | undefined;
}

export function StudioView(props: StudioViewProps) {
  const { siteSlug, hasContent, routeError, navigate } = props;

  return (
    <Box direction="column" gap="large" pad="large" width="100%">
      <Card background="surface" border={{ color: "brand" }} elevation="glow" pad="large" gap="medium">
        <Box direction="row" justify="between" align="center" wrap={true} gap="medium">
          <Box direction="column" gap="xxsmall">
            <Box direction="row" align="center" gap="small">
              <Heading level={2} color="brand" mono>
                STUDIO // @{siteSlug || "author"}
              </Heading>
              <Badge value={hasContent ? "SITE LIVE" : "STARTER DRAFT"} variant={hasContent ? "ok" : "warn"} />
            </Box>
            <Text size="small" color="textMuted" mono>
              Personal Landing URL: https://{siteSlug || "you"}.sites.netslum.macha.sh/
            </Text>
          </Box>

          {navigate && (
            <Box direction="row" gap="small">
              <Button
                label="VIEW LIVE DISTRICT"
                variant="secondary"
                size="small"
                onClick={() => navigate(`/district/${siteSlug}`)}
                bindtap={() => navigate(`/district/${siteSlug}`)}
              />
            </Box>
          )}
        </Box>
      </Card>

      {routeError && (
        <Card background="surface" border={{ color: "statusError" }} pad="medium">
          <Text size="small" color="statusError" mono>
            ⚠ {routeError}
          </Text>
        </Card>
      )}

      {!hasContent ? (
        <Card background="surface" border={{ color: "borderSubtle" }} pad="xxlarge" align="center" gap="medium">
          <Heading level={3} color="text" align="center" mono>
            Ask your agent to make this page your home.
          </Heading>
          <Text size="medium" color="textMuted" align="center" style="max-width:520px;" mono>
            Your AI agent or WebMCP companion can author TSX/HTML components, dynamic widgets, and WebGPU scenes directly into your index.tsx entrypoint.
          </Text>
        </Card>
      ) : (
        <Box align="center" justify="center" pad="large">
          <Text size="small" color="textMuted" mono>
            Rendering your published site…
          </Text>
        </Box>
      )}
    </Box>
  );
}
