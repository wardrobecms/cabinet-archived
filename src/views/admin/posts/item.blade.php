<td><a href="{{ URL::route('wardrobe.post.edit', $post->id) }}">{{ $post->title }}</a></td>
<td>{{ $post->active }}</td>
<td>{{ $post->publish_date }}</td>
<td class="actions">
	<button class="preview"><i class="icon-zoom-in"></i>Preview</button>
	<button class="delete"><i class="icon-trash"></i> Delete</button>
</td>
