<td>
	<a href="{{ URL::route('wardrobe.post.edit', $post->id) }}">{{ $post->title }}</a>
	<a href="#" class="preview"><i class="fa fa-external-link fa-fw"></i></a>
</td>
<td>{{ $post->active }}</td>
<td>{{ $post->publish_date }}</td>
<td class="actions">
	<a href="#" class="delete"><i class="fa fa-trash-o fa-fw"></i>Delete</a>
</td>
