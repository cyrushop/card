"""A very small HTML tree builder on top of the standard library.

Only what the scrapers need: build a tree, find elements by tag / class / id,
and read their text. No third-party packages, so the bot runs on a plain
Python 3.9+ install.
"""
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "source", "track", "wbr"}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = dict(attrs or {})
        self.children = []
        self.parent = parent

    # ---- queries -------------------------------------------------------
    @property
    def classes(self):
        return (self.attrs.get("class") or "").split()

    def iter(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.iter()

    def find_all(self, tag=None, cls=None, pred=None):
        out = []
        for n in self.iter():
            if tag and n.tag != tag:
                continue
            if cls and cls not in n.classes:
                continue
            if pred and not pred(n):
                continue
            out.append(n)
        return out

    def find(self, tag=None, cls=None, pred=None):
        for n in self.iter():
            if tag and n.tag != tag:
                continue
            if cls and cls not in n.classes:
                continue
            if pred and not pred(n):
                continue
            return n
        return None

    def text(self, skip=("script", "style")):
        parts = []

        def walk(node):
            for c in node.children:
                if isinstance(c, str):
                    parts.append(c)
                elif c.tag == "br":
                    parts.append("\n")
                elif c.tag not in skip:
                    walk(c)

        walk(self)
        return "".join(parts)


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        parent = self.stack[-1]
        node = Node(tag, attrs, parent)
        parent.children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        parent = self.stack[-1]
        parent.children.append(Node(tag, attrs, parent))

    def handle_endtag(self, tag):
        # Pop to the nearest open element with this tag; ignore stray end tags.
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse(html):
    b = _Builder()
    b.feed(html)
    b.close()
    return b.root


def clean(s):
    """Collapse whitespace but keep line breaks."""
    lines = [" ".join(line.split()) for line in (s or "").split("\n")]
    return "\n".join(line for line in lines if line).strip()
