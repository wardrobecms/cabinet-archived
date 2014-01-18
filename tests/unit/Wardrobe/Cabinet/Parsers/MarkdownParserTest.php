<?php namespace Wardrobe\Cabinet\Parsers;

use Mockery;
use TestCase;

class MarkdownParserTest extends TestCase {

    private $markdown;

    public function setUp()
    {
        parent::setUp();

        $this->markdown = Mockery::mock('\Michelf\MarkdownExtra');
    }

    public function testParse()
    {
        $this->markdown->shouldReceive('defaultTransform')->once()->with('cabinet')->andReturn('wardrobecms');

        $markdownParser = new MarkdownParser($this->markdown);

        $this->assertSame('wardrobecms', $markdownParser->parse('cabinet'));
    }
}
