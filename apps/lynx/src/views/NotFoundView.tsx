import { Box, Heading, Text, Button, Card } from "../ui/index.js";

export interface NotFoundViewProps {
  navigate: (route: string) => void;
}

export function NotFoundView({ navigate }: NotFoundViewProps) {
  return (
    <Box align="center" justify="center" pad="xxlarge" style="min-height:60vh;width:100%;">
      <Card background="surface" border={{ color: "brand" }} elevation="glow" pad="xlarge" gap="large" align="center" maxWidth="480px">
        <Heading level={1} color="brand" mono>
          404 // SECTOR NOT FOUND
        </Heading>
        <Text size="medium" color="textMuted" align="center" mono>
          The coordinates or vanity district you are attempting to traverse do not exist in the Netslum register.
        </Text>
        <Button
          label="RETURN TO NETSLUM ➔"
          variant="primary"
          size="large"
          onClick={() => navigate("/")}
          bindtap={() => navigate("/")}
        />
      </Card>
    </Box>
  );
}
