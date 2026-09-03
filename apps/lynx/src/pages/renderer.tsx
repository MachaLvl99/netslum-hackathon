import { type ReactNode } from "@lynx-js/react";
import {
  Box,
  Text,
  Heading,
  Paragraph,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Button,
  Avatar,
  Badge,
  Spinner,
  Divider,
  Tag,
  Grid,
  Stack,
  Banner,
  WebGpu3DScene
} from "../ui/index.js";
import type { WebGpuObject3D } from "../webgpu/types.js";
export type ComponentType =
  | "Box"
  | "Text"
  | "Heading"
  | "Paragraph"
  | "Card"
  | "CardHeader"
  | "CardBody"
  | "CardFooter"
  | "Button"
  | "Avatar"
  | "Badge"
  | "Spinner"
  | "Divider"
  | "Tag"
  | "Grid"
  | "Stack"
  | "Banner"
  | "WebGpuWidget"
  | "ActorShowcase"
  | "PortalWidget"
  | "MetricCard"
  | "LinkMatrix";

export interface ComponentNode {
  type: ComponentType;
  props?: Record<string, unknown> | undefined;
  children?: Array<ComponentNode | string> | string | undefined;
}

export interface DynamicPageSchema {
  title?: string | undefined;
  root: ComponentNode;
}

export interface DynamicPageRendererProps {
  schema: DynamicPageSchema | ComponentNode;
  onNavigate?: ((route: string) => void) | undefined;
  onAction?: ((action: string, payload?: unknown) => void) | undefined;
}

/**
 * DynamicPageRenderer — Interprets and renders dynamic UI component trees
 * authored in Studio or via WebMCP tools using the Netslum Lynx UI Framework.
 */
export function DynamicPageRenderer({ schema, onNavigate, onAction }: DynamicPageRendererProps) {
  const rootNode = "root" in schema ? schema.root : schema;

  function renderNode(node: ComponentNode | string, index: number): ReactNode {
    if (typeof node === "string") {
      return <Text key={`text-${index}`} mono>{node}</Text>;
    }

    const { type, props = {}, children } = node;
    const key = `node-${type}-${index}`;

    // Handle interactive callbacks
    const boundProps = { ...props };
    if (typeof props.route === "string" && onNavigate) {
      boundProps.onClick = () => onNavigate(props.route as string);
      boundProps.bindtap = () => onNavigate(props.route as string);
    } else if (typeof props.action === "string" && onAction) {
      boundProps.onClick = () => onAction(props.action as string, props.actionPayload);
      boundProps.bindtap = () => onAction(props.action as string, props.actionPayload);
    }

    const renderedChildren = Array.isArray(children)
      ? children.map((c, i) => renderNode(c, i))
      : typeof children === "string"
      ? children
      : undefined;

    switch (type) {
      case "Box":
        return <Box key={key} {...boundProps}>{renderedChildren}</Box>;
      case "Text":
        return <Text key={key} {...boundProps}>{renderedChildren}</Text>;
      case "Heading":
        return <Heading key={key} {...boundProps}>{renderedChildren}</Heading>;
      case "Paragraph":
        return <Paragraph key={key} {...boundProps}>{renderedChildren}</Paragraph>;
      case "Card":
        return <Card key={key} {...boundProps}>{renderedChildren}</Card>;
      case "CardHeader":
        return <CardHeader key={key} {...boundProps}>{renderedChildren}</CardHeader>;
      case "CardBody":
        return <CardBody key={key} {...boundProps}>{renderedChildren}</CardBody>;
      case "CardFooter":
        return <CardFooter key={key} {...boundProps}>{renderedChildren}</CardFooter>;
      case "Button":
        return <Button key={key} {...boundProps}>{renderedChildren}</Button>;
      case "Avatar":
        return <Avatar key={key} {...boundProps} />;
      case "Badge":
        return <Badge key={key} {...boundProps}>{renderedChildren}</Badge>;
      case "Spinner":
        return <Spinner key={key} {...boundProps} />;
      case "Divider":
        return <Divider key={key} {...boundProps} />;
      case "Tag":
        return <Tag key={key} label={typeof props.label === "string" ? props.label : ""} {...boundProps} />;
      case "Grid":
        return <Grid key={key} {...boundProps}>{renderedChildren}</Grid>;
      case "Stack":
        return <Stack key={key} {...boundProps}>{renderedChildren}</Stack>;
      case "Banner":
        return <Banner key={key} {...boundProps}>{renderedChildren}</Banner>;

      // High-level composite widgets:
      case "FeedWidget": {
        const title = typeof props.title === "string" ? props.title : "LIVE DISPATCHES";
        const posts = Array.isArray(props.posts) ? (props.posts as Array<{ uri?: string; author?: string; text?: string; createdAt?: string }>) : [];
        return (
          <Card key={key} background="surface" border={{ color: "borderSubtle" }} pad="large" gap="medium">
            <CardHeader>
              <Heading level={3} color="brand" mono>{title}</Heading>
              <Badge value={`${posts.length} POSTS`} variant="brand" />
            </CardHeader>
            <CardBody>
              <Box direction="column" gap="small">
                {posts.map((p, pIdx) => (
                  <Box
                    key={`feed-item-${pIdx}`}
                    background="surfaceSubtle"
                    border={{ color: "borderSubtle", size: "1px" }}
                    round="small"
                    pad="medium"
                    gap="xxsmall"
                    style={p.uri && onNavigate ? "cursor:pointer;" : ""}
                    bindtap={p.uri && onNavigate ? () => onNavigate(`/post/${encodeURIComponent(p.uri ?? "")}`) : undefined}
                    onClick={p.uri && onNavigate ? () => onNavigate(`/post/${encodeURIComponent(p.uri ?? "")}`) : undefined}
                  >
                    <Box direction="row" justify="between" align="center">
                      <Text size="small" weight="bold" color="brand" mono>@{p.author ?? "anonymous"}</Text>
                      {p.createdAt && <Text size="xsmall" color="textSubtle" mono>{p.createdAt.slice(0, 10)}</Text>}
                    </Box>
                    <Text size="small" color="text" mono>{p.text ?? ""}</Text>
                  </Box>
                ))}
              </Box>
            </CardBody>
          </Card>
        );
      }

      case "ActorShowcase": {
        const handle = typeof props.handle === "string" ? props.handle : "@traveler";
        const displayName = typeof props.displayName === "string" ? props.displayName : handle;
        const description = typeof props.description === "string" ? props.description : "";
        const avatar = typeof props.avatar === "string" ? props.avatar : undefined;
        return (
          <Card key={key} background="surface" border={{ color: "brand" }} pad="large" gap="medium">
            <Box direction="row" align="center" gap="medium" wrap={true} justify="between">
              <Box direction="row" align="center" gap="medium">
                <Avatar src={avatar} name={displayName} size="large" status="online" />
                <Box direction="column" gap="xxsmall">
                  <Heading level={2} color="text" mono>{displayName}</Heading>
                  <Text size="small" color="brand" mono>{handle}</Text>
                  {description && <Paragraph size="small" color="textMuted">{description}</Paragraph>}
                </Box>
              </Box>
              {onNavigate && (
                <Button
                  label="VIEW PROFILE ➔"
                  variant="primary"
                  size="small"
                  onClick={() => onNavigate(`/profile/${encodeURIComponent(handle.replace(/^@/, ""))}`)}
                  bindtap={() => onNavigate(`/profile/${encodeURIComponent(handle.replace(/^@/, ""))}`)}
                />
              )}
            </Box>
          </Card>
        );
      }

      case "PortalWidget": {
        const sectorName = typeof props.name === "string" ? props.name : "CHAOS GATE PORTAL";
        const sectorKey = typeof props.zoneKey === "string" ? props.zoneKey : "hidden.forbidden.holy_ground";
        const description = typeof props.description === "string" ? props.description : "Warp directly into sector.";
        return (
          <Card
            key={key}
            background="surfaceSubtle"
            border={{ color: "borderFocus", size: "1px" }}
            pad="large"
            gap="small"
            style="cursor:pointer;"
            bindtap={onNavigate ? () => onNavigate(`/zone/${sectorKey}`) : undefined}
            onClick={onNavigate ? () => onNavigate(`/zone/${sectorKey}`) : undefined}
          >
            <Box direction="row" justify="between" align="center">
              <Heading level={3} color="brand" mono>{sectorName}</Heading>
              <Badge value="WARP GATE" variant="ok" />
            </Box>
            <Text size="small" color="textMuted">{description}</Text>
            <Box align="end">
              <Text size="xsmall" color="accentPhosphor" mono>WARP ➔</Text>
            </Box>
          </Card>
        );
      }

      case "MetricCard": {
        const label = typeof props.label === "string" ? props.label : "METRIC";
        const value = typeof props.value === "string" || typeof props.value === "number" ? String(props.value) : "0";
        const change = typeof props.change === "string" ? props.change : "";
        return (
          <Card key={key} background="surfaceSubtle" border={{ color: "borderSubtle", size: "1px" }} pad="medium" gap="xxsmall">
            <Text size="xsmall" color="textSubtle" mono>{label}</Text>
            <Heading level={2} color="brand" mono>{value}</Heading>
            {change && <Text size="xsmall" color="accentPhosphor" mono>{change}</Text>}
          </Card>
        );
      }

      case "LinkMatrix": {
        const links = Array.isArray(props.links) ? (props.links as Array<{ label: string; route?: string; desc?: string }>) : [];
        return (
          <Grid key={key} columns={2} gap="small">
            {links.map((link, lIdx) => (
              <Box
                key={`link-${lIdx}`}
                background="surfaceSubtle"
                border={{ color: "borderSubtle", size: "1px" }}
                round="small"
                pad="medium"
                gap="xxsmall"
                style={link.route && onNavigate ? "cursor:pointer;" : ""}
                bindtap={link.route && onNavigate ? () => onNavigate(link.route ?? "") : undefined}
                onClick={link.route && onNavigate ? () => onNavigate(link.route ?? "") : undefined}
              >
                <Text size="small" weight="bold" color="brand" mono>{link.label}</Text>
                {link.desc && <Text size="xsmall" color="textMuted">{link.desc}</Text>}
              </Box>
            ))}
          </Grid>
        );
      }

      case "WebGpuWidget": {
        const title = typeof props.title === "string" ? props.title : "3D WEBGPU CYBER SCENE";
        const objects = Array.isArray(props.objects) ? (props.objects as WebGpuObject3D[]) : [];
        return (
          <WebGpu3DScene
            key={key}
            title={title}
            objects={objects}
            gridFloor={props.gridFloor !== false}
          />
        );
      }

      default:
        return <Box key={key} {...boundProps}>{renderedChildren}</Box>;
    }
  }

  return <Box width="100%" direction="column">{renderNode(rootNode, 0)}</Box>;
}
